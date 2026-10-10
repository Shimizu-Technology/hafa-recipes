"""Isolated PDF text parser: no network, rendering, attachments or embedded code."""

import io
import json
import resource
import sys

MAX_BYTES = 2 * 1024 * 1024
MAX_PAGES = 30
MAX_CHARS = 30_000


def main():
    # A compressed content stream must not consume the shared API's memory.
    if sys.platform != "darwin":
        resource.setrlimit(resource.RLIMIT_AS, (96 * 1024 * 1024, 96 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_DATA, (96 * 1024 * 1024, 96 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    try:
        from pypdf import PdfReader

        data = sys.stdin.buffer.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError("PDF size limit")
        reader = PdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted or len(reader.pages) > MAX_PAGES:
            raise ValueError("Encrypted or lengthy PDF")
        parts = []
        total = 0
        for index, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            total += len(text)
            if total > MAX_CHARS:
                raise ValueError("PDF text limit")
            parts.append({"location": f"document_page:{index + 1}", "text": text})
        print(json.dumps({"parts": parts}))
    except Exception:
        # Never expose parser errors, attachment metadata or document contents.
        print(json.dumps({"error": "pdf_unreadable_or_limit"}))


if __name__ == "__main__":
    main()
