import requests
from bs4 import BeautifulSoup
import json
from datetime import datetime
from typing import List, Dict, Optional

SOURCES = [
    {
        "name": "EU Sustainable Products Regulation",
        "url": "https://www.consilium.europa.eu/en/documents-publications/",
        "description": "Directive on sustainable products and circular economy"
    },
    {
        "name": "GDPR - Fashion Data Protection",
        "url": "https://ec.europa.eu/justice/article-29/documentation/",
        "description": "General Data Protection Regulation for fashion e-commerce"
    },
    {
        "name": "EU Ecolabel Fashion",
        "url": "https://ec.europa.eu/environment/ecolabel/",
        "description": "Environmental label criteria for textile products"
    },
    {
        "name": "New Circular Economy Action Plan",
        "url": "https://ec.europa.eu/environment/circular-economy/",
        "description": "Circular economy requirements for fashion industry"
    },
]

FALLBACK_DATA = [
    {
        "title": "EU Digital Product Passport (DPP) for Fashion",
        "source": "EU Commission",
        "category": "Sustainability",
        "content": "The Digital Product Passport (DPP) is a requirement for fashion products sold in the EU to include digital information about product origin, material composition, care instructions, environmental impact, and end-of-life options.",
        "url": "https://ec.europa.eu/growth/tools-databases/nando/",
    },
    {
        "title": "GDPR Compliance for Fashion E-commerce",
        "source": "EU Data Protection Authority",
        "category": "Data Protection",
        "content": "Fashion retailers must comply with GDPR by obtaining explicit consent for personal data processing, providing privacy policies, ensuring data portability, and implementing data protection by design.",
        "url": "https://edpb.ec.europa.eu/",
    },
    {
        "title": "EU Ecolabel Criteria for Textiles",
        "source": "European Commission Environment",
        "category": "Environmental",
        "content": "Textile products must meet strict environmental criteria including limited water consumption, restricted hazardous substances, reduced CO2 emissions, and requirements for recycled content portions.",
        "url": "https://ec.europa.eu/environment/ecolabel/",
    },
    {
        "title": "New Cotton Rules and Import Restrictions",
        "source": "EU Trade Policy",
        "category": "Trade",
        "content": "The EU has restricted imports of cotton and cotton products from countries using forced labor. Importers must verify supply chain compliance and provide documentation.",
        "url": "https://policy.trade.ec.europa.eu/",
    },
    {
        "title": "Extended Producer Responsibility (EPR) for Fashion",
        "source": "EU Circular Economy",
        "category": "Waste Management",
        "content": "Fashion producers must take responsibility for the entire lifecycle of products, including end-of-life management, recycling support, and financing waste collection systems.",
        "url": "https://ec.europa.eu/environment/circular-economy/",
    },
    {
        "title": "Size Labeling and Fit Standards",
        "source": "EU Standardization Bodies",
        "category": "Consumer Protection",
        "content": "Fashion brands must comply with EU sizing standards (EN ISO standards) and provide clear, standardized size information to prevent confusion and returns.",
        "url": "https://www.cen.eu/",
    },
]


def fetch_page(url: str) -> Optional[str]:
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Fashion Compliance Crawler)"}
        response = requests.get(url, headers=headers, timeout=5)
        response.raise_for_status()
        return response.text
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None


def parse_regulations(html: str) -> List[str]:
    soup = BeautifulSoup(html, "html.parser")
    paragraphs = soup.find_all(["p", "li", "h2", "h3"])
    return [p.get_text().strip() for p in paragraphs if len(p.get_text().strip()) > 50]


def crawl_fashion_regulations() -> List[Dict]:
    """Crawl EU fashion regulations; fallback to curated data."""
    regulations = []
    
    for source in SOURCES:
        print(f"Crawling {source['name']}...")
        html = fetch_page(source["url"])
        if html:
            paragraphs = parse_regulations(html)
            for para in paragraphs[:3]:  # Limit to 3 paragraphs per source
                regulations.append({
                    "title": source["name"],
                    "source": source["name"],
                    "category": "EU Regulation",
                    "content": para,
                    "url": source["url"],
                    "crawled_at": datetime.now().isoformat(),
                })
        else:
            print(f"  Failed to crawl, using fallback data")
    
    # If crawling failed, supplement with fallback curated data
    if len(regulations) < 5:
        regulations.extend(FALLBACK_DATA)
    
    return regulations


def save_regulations(regulations: List[Dict], filepath: str = "fashion_regulations.json"):
    with open(filepath, "w") as f:
        json.dump(regulations, f, indent=2)
    print(f"Saved {len(regulations)} regulations to {filepath}")


def load_regulations(filepath: str = "fashion_regulations.json") -> List[Dict]:
    try:
        with open(filepath, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"{filepath} not found, crawling...")
        regs = crawl_fashion_regulations()
        save_regulations(regs, filepath)
        return regs


if __name__ == "__main__":
    regulations = crawl_fashion_regulations()
    save_regulations(regulations)
    print(f"\nCollected {len(regulations)} fashion regulations")
    for reg in regulations[:3]:
        print(f"  - {reg['title']}: {reg['content'][:100]}...")
