#!/usr/bin/env python3
"""
Download the Kaggle "fashion-product-images-small" dataset via kagglehub and copy it into ./data
so Docker containers can read it (host cache paths are not visible inside containers).

Requires:
  - python3
  - pip install kagglehub
  - KAGGLEHUB_TOKEN env var (KGAT_...)

Example:
  python3 server/scripts/downloadFashionDatasetFromKaggleHub.py
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path


def load_dotenv(dotenv_path: Path) -> None:
    """Minimal .env loader (only KEY=VALUE, ignores comments)."""
    if not dotenv_path.exists():
        return
    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        # Do not override already-set env vars.
        os.environ.setdefault(key, value.strip())


def find_dataset_layout(root: Path) -> tuple[Path, Path]:
    """
    Locate styles.csv + images dir within kagglehub download output.
    Returns (styles_csv_path, images_dir_path).
    """
    styles_candidates = list(root.rglob("styles.csv"))
    if not styles_candidates:
        raise FileNotFoundError(f"styles.csv not found under {root}")

    # Prefer the shallowest styles.csv
    styles_candidates.sort(key=lambda p: len(p.parts))
    styles_csv = styles_candidates[0]

    images_dir = styles_csv.parent / "images"
    if images_dir.is_dir():
        return styles_csv, images_dir

    # Fallback: search nearby, then full tree.
    nearby = [p for p in styles_csv.parent.rglob("images") if p.is_dir()]
    if nearby:
        nearby.sort(key=lambda p: len(p.parts))
        return styles_csv, nearby[0]

    all_images = [p for p in root.rglob("images") if p.is_dir()]
    if all_images:
        all_images.sort(key=lambda p: len(p.parts))
        return styles_csv, all_images[0]

    raise FileNotFoundError(f"images directory not found under {root}")


def copy_dataset(styles_csv: Path, images_dir: Path, dest_dir: Path) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_images = dest_dir / "images"

    shutil.copy2(styles_csv, dest_dir / "styles.csv")

    # Copy images (can be large). We use dirs_exist_ok for resumable runs.
    shutil.copytree(images_dir, dest_images, dirs_exist_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Download Kaggle fashion dataset (small) with kagglehub into ./data")
    parser.add_argument(
        "--dataset",
        default="paramaggarwal/fashion-product-images-small",
        help="Kaggle dataset slug (default: paramaggarwal/fashion-product-images-small)",
    )
    parser.add_argument(
        "--dest",
        default="data/fashion-product-images-dataset",
        help="Destination directory in repo (default: data/fashion-product-images-dataset)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing destination directory",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    load_dotenv(repo_root / ".env")

    token = os.environ.get("KAGGLEHUB_TOKEN", "").strip()
    if not token:
        print("ERROR: KAGGLEHUB_TOKEN is not set (expected KGAT_...)", file=sys.stderr)
        return 2

    try:
        import kagglehub  # type: ignore
    except Exception as exc:
        print("ERROR: kagglehub not installed. Run: python3 -m pip install --user kagglehub", file=sys.stderr)
        print(f"DETAIL: {exc}", file=sys.stderr)
        return 2

    dest_dir = (repo_root / args.dest).resolve()
    if dest_dir.exists():
        if not args.force:
            # If it looks complete, skip; otherwise, user can pass --force.
            styles_exists = (dest_dir / "styles.csv").exists()
            images_exists = (dest_dir / "images").is_dir()
            if styles_exists and images_exists:
                print(f"[kagglehub] destination already present: {dest_dir}")
                print("[kagglehub] skipping (use --force to overwrite)")
                return 0
        shutil.rmtree(dest_dir)

    print(f"[kagglehub] downloading dataset: {args.dataset}")
    downloaded_path = Path(kagglehub.dataset_download(args.dataset))
    print(f"[kagglehub] raw download path: {downloaded_path}")

    styles_csv, images_dir = find_dataset_layout(downloaded_path)
    print(f"[kagglehub] found styles.csv: {styles_csv}")
    print(f"[kagglehub] found images dir: {images_dir}")

    print(f"[kagglehub] copying to: {dest_dir}")
    copy_dataset(styles_csv, images_dir, dest_dir)

    print("[kagglehub] complete")
    print(f"[kagglehub] dataset ready at: {dest_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

