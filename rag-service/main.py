import os
import re
import uuid
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing_extensions import TypedDict

import io
import base64
import numpy as np
from PIL import Image
from rembg import remove
import mediapipe as mp

from langgraph.graph import END, StateGraph

from crawler import load_regulations

load_dotenv()

def normalize_weaviate_host(value: str) -> str:
    host = (value or "").strip().rstrip("/")
    if not host:
        return ""
    if host.startswith("http://") or host.startswith("https://"):
        return host
    return f"https://{host}"


WEAVIATE_HOST = normalize_weaviate_host(
    os.getenv("WEAVIATE_URL")
    or os.getenv("WEAVIATE_HOST")
    or "http://weaviate:8080"
)
WEAVIATE_API_KEY = os.getenv("WEAVIATE_API_KEY", "local-dev-key")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
HF_API_TOKEN = os.getenv("HF_API_TOKEN", "") or os.getenv("HUGGINGFACE_API_KEY", "")
HF_MODEL = os.getenv("HF_MODEL", "mistralai/Mistral-7B-Instruct-v0.2")
HF_FALLBACK_MODEL = os.getenv("HF_FALLBACK_MODEL", "meta-llama/Llama-3.1-8B-Instruct")
HF_CHAT_COMPLETIONS_URL = os.getenv(
    "HF_CHAT_COMPLETIONS_URL",
    "https://router.huggingface.co/v1/chat/completions",
).rstrip("/")
HF_WAIT_FOR_MODEL = os.getenv("HF_WAIT_FOR_MODEL", "true").strip().lower() in ("1", "true", "yes", "on")
COLLECTION_NAME = os.getenv("WEAVIATE_CLASS", "Doc")
REQUEST_TIMEOUT = float(os.getenv("RAG_REQUEST_TIMEOUT", "20"))

CLASS_NAME_PATTERN = re.compile(r"^[A-Z][A-Za-z0-9_]*$")

app = FastAPI(title="Fashion RAG Service")

# Allow cross-origin so the frontend can call segmentation directly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "service": "fashion-rag-service",
        "status": "ok",
        "docs": "/docs",
        "health": "/health",
        "endpoints": {
            "chat": {"method": "POST", "path": "/chat"},
            "ingest": {"method": "POST", "path": "/ingest"},
            "ingest_crawled": {"method": "POST", "path": "/ingest-crawled"},
            "segment_cloth_only": {"method": "POST", "path": "/segment/cloth-only"},
        },
    }


class IngestDoc(BaseModel):
    text: str = Field(min_length=1)
    source: str = "custom"
    url: Optional[str] = None
    category: str = "general"


class IngestRequest(BaseModel):
    docs: List[IngestDoc]
    chunk_size: int = Field(default=800, ge=100, le=2000)
    chunk_overlap: int = Field(default=100, ge=0, le=500)


class ChatRequest(BaseModel):
    query: str = Field(min_length=1)
    limit: int = Field(default=5, ge=1, le=10)


class ClothCutoutRequest(BaseModel):
    imageUrl: str = Field(default="", alias="image_url")
    imageBase64: str = Field(default="", alias="image_base64")


class RagState(TypedDict):
    query: str
    limit: int
    rewritten_query: str
    retrieved_docs: List[Dict[str, Any]]
    answer: str


def weaviate_headers() -> Dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if WEAVIATE_API_KEY:
        headers["Authorization"] = f"Bearer {WEAVIATE_API_KEY}"
    return headers


def weaviate_request(method: str, path: str, **kwargs: Any) -> requests.Response:
    url = f"{WEAVIATE_HOST}{path}"
    headers = kwargs.pop("headers", {})
    merged_headers = weaviate_headers()
    merged_headers.update(headers)
    return requests.request(
        method,
        url,
        headers=merged_headers,
        timeout=REQUEST_TIMEOUT,
        **kwargs,
    )


def ensure_collection() -> None:
    if not CLASS_NAME_PATTERN.match(COLLECTION_NAME):
        raise RuntimeError(
            "WEAVIATE_CLASS must start with an uppercase letter and contain only letters, numbers, and underscores."
        )

    exists = weaviate_request("GET", f"/v1/schema/{COLLECTION_NAME}")
    if exists.status_code == 200:
        return
    if exists.status_code != 404:
        raise RuntimeError(f"Failed to read schema: {exists.status_code} {exists.text}")

    payload = {
        "class": COLLECTION_NAME,
        "description": "Fashion regulation chunks for customer support RAG",
        "vectorizer": "none",
        "properties": [
            {"name": "text", "dataType": ["text"]},
            {"name": "source", "dataType": ["text"]},
            {"name": "url", "dataType": ["text"]},
            {"name": "category", "dataType": ["text"]},
        ],
    }

    created = weaviate_request("POST", "/v1/schema", json=payload)
    if created.status_code not in (200, 201):
        raise RuntimeError(f"Failed to create schema: {created.status_code} {created.text}")


def chunk_text(text: str, chunk_size: int, chunk_overlap: int) -> List[str]:
    normalized = " ".join(text.split())
    if not normalized:
        return []

    step = max(1, chunk_size - chunk_overlap)
    chunks: List[str] = []
    for start in range(0, len(normalized), step):
        chunk = normalized[start : start + chunk_size].strip()
        if chunk:
            chunks.append(chunk)
        if start + chunk_size >= len(normalized):
            break
    return chunks


def build_records(docs: List[IngestDoc], chunk_size: int, chunk_overlap: int) -> List[Dict[str, str]]:
    records: List[Dict[str, str]] = []
    for doc in docs:
        for chunk in chunk_text(doc.text, chunk_size, chunk_overlap):
            records.append(
                {
                    "id": str(uuid.uuid4()),
                    "text": chunk,
                    "source": doc.source,
                    "url": doc.url or "",
                    "category": doc.category,
                }
            )
    return records


def insert_records(records: List[Dict[str, str]]) -> int:
    if not records:
        return 0

    ensure_collection()
    objects = [
        {
            "class": COLLECTION_NAME,
            "id": item["id"],
            "properties": {
                "text": item["text"],
                "source": item["source"],
                "url": item["url"],
                "category": item["category"],
            },
        }
        for item in records
    ]

    response = weaviate_request("POST", "/v1/batch/objects", json={"objects": objects})
    if response.status_code not in (200, 202):
        raise RuntimeError(f"Failed to insert objects: {response.status_code} {response.text}")

    payload = response.json()
    object_results = payload.get("objects", []) if isinstance(payload, dict) else payload
    failed = 0
    for result in object_results:
        errors = result.get("result", {}).get("errors")
        if errors:
            failed += 1

    if failed:
        raise RuntimeError(f"Failed to ingest {failed} chunks.")

    return len(records)


def retrieve_documents(query: str, limit: int) -> List[Dict[str, Any]]:
    ensure_collection()
    escaped_query = query.replace("\\", "\\\\").replace('"', '\\"')
    graphql_query = f"""
    {{
      Get {{
        {COLLECTION_NAME}(bm25: {{ query: "{escaped_query}" }} limit: {int(limit)}) {{
          text
          source
          url
          category
          _additional {{
            score
          }}
        }}
      }}
    }}
    """

    response = weaviate_request(
        "POST",
        "/v1/graphql",
        json={"query": graphql_query},
    )
    if response.status_code != 200:
        raise RuntimeError(f"Failed to query Weaviate: {response.status_code} {response.text}")

    payload = response.json()
    errors = payload.get("errors")
    if errors:
        raise RuntimeError("; ".join([e.get("message", "Unknown GraphQL error") for e in errors]))

    docs = payload.get("data", {}).get("Get", {}).get(COLLECTION_NAME, [])
    results: List[Dict[str, Any]] = []
    for doc in docs:
        additional = doc.get("_additional") or {}
        results.append(
            {
                "text": doc.get("text", ""),
                "source": doc.get("source", "unknown"),
                "url": doc.get("url", ""),
                "category": doc.get("category", "general"),
                "score": additional.get("score"),
            }
        )
    return results


def build_context(docs: List[Dict[str, Any]]) -> str:
    lines: List[str] = []
    for index, doc in enumerate(docs, start=1):
        source = doc.get("source") or "unknown"
        url = doc.get("url") or ""
        url_part = f" | URL: {url}" if url else ""
        lines.append(f"{index}. {doc.get('text', '')}\nSource: {source}{url_part}")
    return "\n\n".join(lines)


def fallback_answer(query: str, docs: List[Dict[str, Any]]) -> str:
    if not docs:
        return (
            "I could not find matching policy context yet. "
            "Please ingest regulations first, then ask again."
        )

    snippets: List[str] = []
    for doc in docs[:3]:
        text = (doc.get("text") or "").strip()
        short = f"{text[:220]}..." if len(text) > 220 else text
        source = doc.get("source") or "unknown"
        snippets.append(f"- {short} (source: {source})")

    return (
        f"I found relevant fashion regulation context for: '{query}'.\n"
        + "\n".join(snippets)
    )


def call_huggingface_completion(system_prompt: str, user_prompt: str) -> Optional[str]:
    if not HF_API_TOKEN:
        return None

    def invoke_router(model_name: str) -> Optional[str]:
        response = requests.post(
            HF_CHAT_COMPLETIONS_URL,
            headers={
                "Authorization": f"Bearer {HF_API_TOKEN}",
                "Content-Type": "application/json",
            },
            json={
                "model": model_name,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.1,
                "max_tokens": 320,
            },
            timeout=max(REQUEST_TIMEOUT, 90),
        )

        if response.status_code >= 400:
            body = response.text or ""
            short_body = body[:400].replace("\n", " ")
            print(f"HF router error ({model_name}): {response.status_code} {short_body}")

            if response.status_code == 400:
                try:
                    payload = response.json()
                except Exception:
                    return None

                message = (
                    payload.get("error", {}).get("message", "")
                    if isinstance(payload, dict)
                    else ""
                )
                if (
                    "not supported" in message.lower()
                    and HF_FALLBACK_MODEL
                    and HF_FALLBACK_MODEL != model_name
                ):
                    return invoke_router(HF_FALLBACK_MODEL)
            return None

        payload = response.json()
        choices = payload.get("choices")
        if isinstance(choices, list) and choices:
            first_choice = choices[0] if isinstance(choices[0], dict) else {}
            message = first_choice.get("message") if isinstance(first_choice.get("message"), dict) else {}
            content = (message.get("content") or "").strip()
            if content:
                return content

        text = (payload.get("generated_text") or "").strip() if isinstance(payload, dict) else ""
        return text or None

    try:
        return invoke_router(HF_MODEL)
    except Exception as exc:
        print(f"HF router exception: {exc}")
        return None


def generate_answer(query: str, docs: List[Dict[str, Any]]) -> str:
    if not docs:
        return "No relevant documents were found for this question."

    system_prompt = (
        "You are a customer support assistant for a fashion retailer. "
        "Answer only from the provided regulatory context. "
        "If context is insufficient, state that clearly. "
        "Include short source mentions."
    )
    user_prompt = (
        f"Customer question: {query}\n\n"
        f"Regulatory context:\n{build_context(docs)}\n\n"
        "Return a concise answer with 2-4 bullet points where useful."
    )

    if not OPENAI_API_KEY and HF_API_TOKEN:
        hf_answer = call_huggingface_completion(system_prompt, user_prompt)
        return hf_answer or fallback_answer(query, docs)

    if not OPENAI_API_KEY:
        return fallback_answer(query, docs)

    try:
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": OPENAI_MODEL,
                "temperature": 0.1,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            },
            timeout=REQUEST_TIMEOUT,
        )

        if response.status_code >= 400:
            return fallback_answer(query, docs)

        payload = response.json()
        content = (
            payload.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            .strip()
        )
        return content or fallback_answer(query, docs)
    except Exception:
        return fallback_answer(query, docs)


def rewrite_query_node(state: RagState) -> RagState:
    state["rewritten_query"] = " ".join(state["query"].split())
    return state


def retrieve_node(state: RagState) -> RagState:
    state["retrieved_docs"] = retrieve_documents(state["rewritten_query"], state["limit"])
    return state


def generate_node(state: RagState) -> RagState:
    state["answer"] = generate_answer(state["query"], state["retrieved_docs"])
    return state


def build_rag_graph():
    graph = StateGraph(RagState)
    graph.add_node("rewrite", rewrite_query_node)
    graph.add_node("retrieve", retrieve_node)
    graph.add_node("generate", generate_node)

    graph.set_entry_point("rewrite")
    graph.add_edge("rewrite", "retrieve")
    graph.add_edge("retrieve", "generate")
    graph.add_edge("generate", END)

    return graph.compile()


rag_graph = build_rag_graph()


@app.on_event("startup")
def on_startup() -> None:
    try:
        ensure_collection()
    except Exception as exc:
        print(f"Startup warning: unable to validate Weaviate collection: {exc}")


@app.post("/ingest")
async def ingest(req: IngestRequest):
    if not req.docs:
        raise HTTPException(status_code=400, detail="docs is required")
    if req.chunk_overlap >= req.chunk_size:
        raise HTTPException(status_code=400, detail="chunk_overlap must be smaller than chunk_size")

    records = build_records(req.docs, req.chunk_size, req.chunk_overlap)
    if not records:
        raise HTTPException(status_code=400, detail="No ingestible text found in docs")

    try:
        ingested = insert_records(records)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Ingestion failed: {exc}") from exc

    return {"ingested": ingested, "documents": len(req.docs), "chunks": len(records)}


@app.post("/ingest-crawled")
async def ingest_crawled():
    regulations = load_regulations()

    docs: List[IngestDoc] = []
    for row in regulations:
        content = (row.get("content") or "").strip()
        if not content:
            continue
        docs.append(
            IngestDoc(
                text=content,
                source=row.get("source", "crawler"),
                url=row.get("url"),
                category=row.get("category", "general"),
            )
        )

    if not docs:
        raise HTTPException(status_code=400, detail="No crawled regulation content found")

    records = build_records(docs, chunk_size=800, chunk_overlap=100)

    try:
        ingested = insert_records(records)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Crawled ingestion failed: {exc}") from exc

    return {
        "ingested": ingested,
        "documents": len(docs),
        "chunks": len(records),
        "source": "crawled_regulations",
    }


@app.post("/chat")
async def chat(req: ChatRequest):
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required")

    initial_state: RagState = {
        "query": query,
        "limit": req.limit,
        "rewritten_query": "",
        "retrieved_docs": [],
        "answer": "",
    }

    try:
        result = rag_graph.invoke(initial_state)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"RAG workflow failed: {exc}") from exc

    return {
        "query": query,
        "rewritten_query": result["rewritten_query"],
        "answer": result["answer"],
        "context": result["retrieved_docs"],
    }


@app.get("/health")
async def health():
    weaviate_ready = False
    weaviate_error = None
    collection_exists = False

    try:
        ready = weaviate_request("GET", "/v1/.well-known/ready")
        # Some Weaviate builds return an empty body with 200 for readiness.
        ready_text = ready.text.strip().lower()
        weaviate_ready = ready.status_code == 200 and (ready_text in ("", "true"))
    except Exception as exc:
        weaviate_error = str(exc)

    try:
        schema = weaviate_request("GET", f"/v1/schema/{COLLECTION_NAME}")
        collection_exists = schema.status_code == 200
    except Exception as exc:
        if not weaviate_error:
            weaviate_error = str(exc)

    return {
        "status": "ok" if weaviate_ready else "degraded",
        "langgraph": "ready",
        "collection": COLLECTION_NAME,
        "collection_exists": collection_exists,
        "weaviate_ready": weaviate_ready,
        "weaviate_error": weaviate_error,
    }


def fetch_image_bytes(url: str) -> bytes:
    response = requests.get(url, timeout=REQUEST_TIMEOUT)
    if response.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Failed to fetch image: HTTP {response.status_code}")
    content_type = response.headers.get("content-type", "")
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="URL did not return an image")
    return response.content


def decode_base64_image(data: str) -> bytes:
    try:
        stripped = data.replace("data:image/png;base64,", "").replace("data:image/jpeg;base64,", "")
        return base64.b64decode(stripped)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=400, detail=f"Invalid base64 image: {exc}")


def remove_background_and_face(image_bytes: bytes) -> Image.Image:
    # Background removal via U2Net (rembg)
    cutout_bytes = remove(image_bytes)
    cutout = Image.open(io.BytesIO(cutout_bytes)).convert("RGBA")

    # Face removal using MediaPipe Face Detection (lightweight, CPU)
    try:
        mp_face = mp.solutions.face_detection.FaceDetection(model_selection=0, min_detection_confidence=0.5)
        np_img = np.array(cutout.convert("RGB"))
        results = mp_face.process(np_img)
        if results.detections:
          
            w, h = cutout.size
            alpha = np.array(cutout.getchannel("A"))
            for det in results.detections:
                box = det.location_data.relative_bounding_box
                x_min = int(max(0, box.xmin) * w)
                y_min = int(max(0, box.ymin) * h)
                x_max = int(min(1, box.xmin + box.width) * w)
                y_max = int(min(1, box.ymin + box.height) * h)
                alpha[y_min:y_max, x_min:x_max] = 0
            cutout.putalpha(Image.fromarray(alpha))
    except Exception:
        # If face detection fails, proceed with background-only cutout.
        pass

    return cutout


def encode_png_base64(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


@app.post("/segment/cloth-only")
async def cloth_only(req: ClothCutoutRequest):
    image_url = (req.imageUrl or "").strip()
    image_b64 = (req.imageBase64 or "").strip()

    if not image_url and not image_b64:
        raise HTTPException(status_code=400, detail="imageUrl or imageBase64 is required")

    image_bytes = decode_base64_image(image_b64) if image_b64 else fetch_image_bytes(image_url)

    cutout = remove_background_and_face(image_bytes)
    alpha = np.array(cutout.getchannel("A"))
    visible = int(np.count_nonzero(alpha > 0))
    if visible < 2000:
        raise HTTPException(status_code=422, detail="Segmentation too small or empty")

    b64_png = encode_png_base64(cutout)
    return {
        "cutout": f"data:image/png;base64,{b64_png}",
        "visible_pixels": visible,
    }
