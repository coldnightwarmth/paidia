#!/usr/bin/env python3
"""Import readable prose from shortform PDFs into their page JSON records."""

from __future__ import annotations

import argparse
import html
import json
import logging
import math
import re
import shutil
import subprocess
import tempfile
import unicodedata
from collections import Counter
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
DATABASE_PATH = ROOT / "data" / "shortform-database.json"
PAGES_DIR = ROOT / "data" / "pages"
SOURCE_MARKER = "pdf-text-extraction"
MAX_PAGES = 30

SECTION_HEADINGS = {
    "abstract",
    "introduction",
    "background",
    "context",
    "discussion",
    "analysis",
    "conclusion",
    "conclusions",
    "epilogue",
    "notes",
}
END_HEADINGS = {
    "references",
    "bibliography",
    "works cited",
    "works consulted",
    "about the author",
    "about the authors",
}
TRAILING_FURNITURE_PATTERNS = [
    re.compile(pattern, re.I)
    for pattern in (
        r"\bAbout Us\s+Reprints",
        r"\bAll products recommended by Engadget\b",
        r"\bPopular on Engadget\b",
        r"\bSUBSCRIBE As a knowledge worker\b",
        r"\bJoin 40,000 mindful makers\b",
        r"\bYou['’]ve reached the end of the article\b",
        r"^CONTACT US$",
        r"\bCONTACT US\b.*?\bPRESS\b",
        r"\bSign up for MerzFiles\b",
        r"\bFollow BBC Earth\b",
        r"\b2022 © Ness Labs\b",
        r"\bSections\s+v?\s*About\s+Contribute",
        r"\bThis article was community supported",
        r"\bMORE ABOUT GAMING\b",
        r"\bTHIS WEEK['’]S ISSUE\b",
        r"\bNever miss a big New Yorker story",
        r"\bPublished in the print edition",
        r"\bDigiti[sz]ed by Google\b",
        r"\b\d+ repl(?:y|ies) by\b",
        r"\b\d+ Comments?\b",
        r"\bWrite a comment\b",
        r"\bGame Design\s*\|\s*Hospitality\b",
        r"\bAgency\s*\|\s*Free Will\s*\|",
        r"\bThe Complexity of Connecting\b",
        r"\bBlog About Contact Subscribe\b",
    )
]
TITLE_STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "as",
    "with", "from", "by", "is", "it", "its", "at", "what", "why", "how",
}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_line(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "")
    value = value.replace("\u00ad", "").replace("\u200b", "")
    value = re.sub(r"\bhome\s+about\s+archive\s+RSS\b", "", value, flags=re.I)
    return re.sub(r"\s+", " ", value).strip()


def comparison_text(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).casefold()
    value = "".join(char for char in value if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def is_page_number(line: str) -> bool:
    text = comparison_text(line)
    return bool(
        re.fullmatch(r"(?:page )?\d+(?: (?:of )?\d+)?", text)
        or re.fullmatch(r"[ivxlcdm]{1,8}", text)
    )


def is_noise_line(line: str) -> bool:
    text = comparison_text(line)
    if not text or is_page_number(line):
        return True
    return bool(
        re.match(r"^(?:downloaded|retrieved|accessed) from\b", text)
        or re.match(r"^(?:https? |www )", text)
        or re.match(r"^doi\b", text)
        or re.match(r"^issn\b", text)
        or re.match(r"^copyright\b", text)
        or re.match(r"^all rights reserved\b", text)
    )


def title_tokens(title: str) -> set[str]:
    return {
        token
        for token in comparison_text(title).split()
        if len(token) > 2 and token not in TITLE_STOPWORDS
    }


def find_content_start(lines: list[str], title: str) -> int:
    early_limit = min(len(lines), 140)
    for index, line in enumerate(lines[:early_limit]):
        if comparison_text(line) == "abstract":
            return index

    wanted = title_tokens(title)
    if wanted:
        best: tuple[float, int] | None = None
        for start in range(early_limit):
            combined = ""
            for end in range(start, min(early_limit, start + 6)):
                combined = f"{combined} {lines[end]}".strip()
                found = set(comparison_text(combined).split())
                coverage = len(wanted & found) / len(wanted)
                if coverage >= 0.72 and (best is None or coverage > best[0]):
                    best = (coverage, end + 1)
        if best:
            start = best[1]
            while start < len(lines) and (
                comparison_text(lines[start]).startswith("by ")
                or len(comparison_text(lines[start]).split()) <= 2
            ):
                start += 1
            return start

    for index, line in enumerate(lines[:early_limit]):
        if not is_noise_line(line):
            return index
    return 0


def is_section_heading(line: str) -> bool:
    text = comparison_text(line)
    if text in SECTION_HEADINGS:
        return True
    return bool(
        len(line) <= 90
        and re.match(r"^(?:\d+(?:\.\d+)*[.)]?|[ivxlcdm]+[.)])\s+\S", line, re.I)
        and not re.search(r"[.!?][\"'’”)]?$", line)
    )


def join_wrapped_lines(lines: list[str]) -> str:
    text = ""
    for line in lines:
        if not text:
            text = line
        elif text.endswith("-") and line and line[0].islower():
            text = text[:-1] + line
        else:
            text += " " + line
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


def make_text_blocks(lines_by_page: list[list[str]], title: str) -> list[dict]:
    page_line_sets = [
        {comparison_text(line) for line in lines if comparison_text(line)}
        for lines in lines_by_page
    ]
    frequency = Counter(text for texts in page_line_sets for text in texts)
    repeat_threshold = max(2, math.ceil(len(lines_by_page) * 0.34))

    cleaned_pages: list[list[str]] = []
    for lines in lines_by_page:
        cleaned: list[str] = []
        for line in lines:
            normalized = comparison_text(line)
            has_trailing_marker = any(
                pattern.search(line) for pattern in TRAILING_FURNITURE_PATTERNS
            )
            repeated_furniture = (
                len(normalized) < 160
                and frequency[normalized] >= repeat_threshold
                and normalized not in SECTION_HEADINGS
            )
            if (repeated_furniture and not has_trailing_marker) or is_noise_line(line):
                continue
            cleaned.append(line)
        cleaned_pages.append(cleaned)

    flattened = [line for page in cleaned_pages for line in page]
    start = find_content_start(flattened, title)
    flattened = flattened[start:]

    running_characters = 0
    minimum_end_position = max(200, sum(map(len, flattened)) * 0.25)
    body_lines: list[str] = []
    for line in flattened:
        normalized = comparison_text(line)
        if normalized in END_HEADINGS and running_characters >= minimum_end_position:
            break
        furniture_match = next(
            (pattern.search(line) for pattern in TRAILING_FURNITURE_PATTERNS if pattern.search(line)),
            None,
        )
        if furniture_match:
            prose_prefix = line[:furniture_match.start()].strip(" |:-")
            if len(comparison_text(prose_prefix)) >= 4:
                body_lines.append(prose_prefix)
            break
        body_lines.append(line)
        running_characters += len(line)

    blocks: list[dict] = []
    paragraph_lines: list[str] = []

    def flush_paragraph() -> None:
        if not paragraph_lines:
            return
        text = join_wrapped_lines(paragraph_lines)
        paragraph_lines.clear()
        if len(comparison_text(text)) < 2:
            return
        blocks.append({
            "type": "paragraph",
            "html": html.escape(text, quote=False),
            "source": SOURCE_MARKER,
        })

    for line in body_lines:
        if is_section_heading(line):
            flush_paragraph()
            blocks.append({
                "type": "subheader",
                "html": html.escape(line, quote=False),
                "source": SOURCE_MARKER,
            })
            continue
        paragraph_lines.append(line)
        length = sum(len(part) for part in paragraph_lines)
        sentence_end = bool(re.search(r"[.!?][\"'’”)]?$", line))
        if length >= 1100 or (length >= 360 and sentence_end):
            flush_paragraph()
    flush_paragraph()
    return blocks


def extract_pdf_blocks(pdf_path: Path, title: str) -> tuple[int, list[dict]]:
    reader = PdfReader(pdf_path, strict=False)
    page_count = len(reader.pages)
    if page_count > MAX_PAGES:
        return page_count, []

    pages: list[list[str]] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        pages.append([
            line
            for line in (normalize_line(part) for part in text.splitlines())
            if line
        ])
    if sum(len(line) for page in pages for line in page) < 200:
        return page_count, []
    return page_count, make_text_blocks(pages, title)


def ocr_pdf_blocks(pdf_path: Path, title: str, page_count: int, ocr_command: Path) -> list[dict]:
    temp_root = ROOT / "tmp" / "pdfs"
    temp_root.mkdir(parents=True, exist_ok=True)
    pdftoppm = shutil.which("pdftoppm") or str(
        Path.home()
        / ".cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/pdftoppm"
    )
    with tempfile.TemporaryDirectory(prefix="shortform-ocr-", dir=temp_root) as temp_dir:
        prefix = Path(temp_dir) / "page"
        subprocess.run(
            [pdftoppm, "-jpeg", "-r", "144", str(pdf_path), str(prefix)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=max(120, page_count * 30),
        )
        images = sorted(Path(temp_dir).glob("page-*.jpg"))
        result = subprocess.run(
            [str(ocr_command), *(str(image) for image in images)],
            check=True,
            capture_output=True,
            text=True,
            timeout=max(180, page_count * 45),
        )

    pages: list[list[str]] = []
    current: list[str] | None = None
    for raw_line in result.stdout.splitlines():
        if raw_line.startswith("===PAGE===\t"):
            current = []
            pages.append(current)
            continue
        line = normalize_line(raw_line)
        if current is not None and line:
            current.append(line)
    if sum(len(line) for page in pages for line in page) < 200:
        return []
    return make_text_blocks(pages, title)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--ocr-command", type=Path)
    parser.add_argument("--only-ocr", action="store_true")
    args = parser.parse_args()

    logging.getLogger("pypdf").setLevel(logging.ERROR)
    database = load_json(DATABASE_PATH)
    counts = Counter()

    for row, metadata in zip(database["rows"], database["rowMeta"]):
        page_path = PAGES_DIR / f"{metadata['pageId']}.json"
        page = load_json(page_path)
        page["blocks"] = [
            block for block in page.get("blocks", [])
            if block.get("source") != SOURCE_MARKER
        ]
        pdf_index = next((
            index for index, block in enumerate(page["blocks"])
            if block.get("type") == "file" and block.get("kind") == "pdf"
        ), -1)
        if pdf_index < 0:
            counts["no_pdf"] += 1
            continue

        pdf_path = ROOT / page["blocks"][pdf_index]["src"].removeprefix("./")
        try:
            page_count, text_blocks = extract_pdf_blocks(pdf_path, row[0])
        except Exception as error:  # Keep the original embed if a malformed PDF fails.
            counts["errors"] += 1
            print(f"ERROR\t{row[0]}\t{error}")
            continue

        if text_blocks and args.only_ocr:
            counts["skipped_text_pdf"] += 1
            continue

        if page_count > MAX_PAGES:
            counts["over_30_pages"] += 1
            continue
        if not text_blocks:
            if args.ocr_command:
                try:
                    text_blocks = ocr_pdf_blocks(
                        pdf_path, row[0], page_count, args.ocr_command.resolve()
                    )
                except Exception as error:
                    print(f"OCR_ERROR\t{row[0]}\t{error}")
            if not text_blocks:
                counts["needs_ocr"] += 1
                print(f"OCR\t{page_count}\t{row[0]}")
                continue
            counts["ocr_imported"] += 1

        for block_index, block in enumerate(text_blocks, start=1):
            block["id"] = f"pdf-text-{metadata['pageId']}-{block_index:04d}"
        page["blocks"][pdf_index:pdf_index] = text_blocks
        counts["imported"] += 1
        counts["blocks"] += len(text_blocks)
        if not args.dry_run:
            page_path.write_text(
                json.dumps(page, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

    print("\n".join(f"{key}: {value}" for key, value in sorted(counts.items())))


if __name__ == "__main__":
    main()
