# RAG Service for Fashion Compliance

A LangGraph-powered RAG service that crawls EU fashion regulations, chunks and embeds them, stores in Weaviate, and answers compliance questions using LLMs.

## Architecture

```
Crawler (EU regulations) 
  → Load regulations (local JSON fallback) 
  → Chunk (800 chars, 100 overlap) 
  → Store in Weaviate
  
Request: /chat
  → LangGraph workflow:
     1. Rewrite query (optional)
     2. Retrieve from Weaviate (BM25 text search)
     3. Generate answer (OpenAI or Hugging Face Mistral API + context)
  → Response: answer + cited sources
```

## Endpoints

- `POST /ingest` - Ingest custom documents
- `POST /ingest-crawled` - Crawl EU fashion regulations and ingest
- `POST /chat` - Query the RAG system
- `GET /health` - Service health

## Environment Variables

```bash
WEAVIATE_HOST=http://weaviate:8080
WEAVIATE_API_KEY=<your-key>
OPENAI_API_KEY=<optional-for-generation>
HF_API_TOKEN=<optional-huggingface-token>
HF_MODEL=mistralai/Mistral-7B-Instruct-v0.2
```

## Usage

### 1. Ingest crawled regulations
```bash
curl -X POST http://localhost:8000/ingest-crawled
```

### 2. Ask a question
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "What are EU requirements for sustainable fashion?"}'
```

### 3. Get structured output
Response includes:
- `answer`: LLM-generated compliance answer
- `context`: Retrieved documents with sources/URLs
- `query`: Original question

## Data Sources

By default, uses curated EU fashion regulation data:
- Digital Product Passport (DPP)
- GDPR compliance
- Ecolabel criteria
- Extended Producer Responsibility (EPR)
- Size labeling standards

Crawls from EU Commission sources if network available; falls back to local curated data.

## Notes

- All crawled data stored locally in `fashion_regulations.json`
- Chunk size/overlap configurable via `/ingest` endpoint
- Generation priority:
  - OpenAI if `OPENAI_API_KEY` is set
  - Hugging Face if `HF_API_TOKEN`/`HUGGINGFACE_API_KEY` is set
  - Retrieval-only fallback otherwise
