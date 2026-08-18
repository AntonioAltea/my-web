from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image


ZINE_MANIFEST_NAME = ".zine-manifest.json"
ZINE_COLUMNS = 4
ZINE_ROWS = 2
ZINE_PAGE_COUNT = ZINE_COLUMNS * ZINE_ROWS
# These sheets are a single flattened 300 dpi scan, which leaves about 877 px
# per panel. The upper bound is deliberately above that so the large variant is
# whatever the sheet actually holds instead of an upscale.
ZINE_VARIANT_MAX_WIDTHS = (440, 1520)
RENDER_DPI = 300
# The sheet carries a dashed cut guide about two pixels wide around its outer
# edge. Left in, it shows up as a dotted line along two sides of every page.
SHEET_BORDER_TRIM = 3
# Page URLs are cached as immutable, and their version is built from this
# number plus the source PDF. Bump it whenever slicing changes, or readers keep
# the images they already have.
PREPARE_VERSION = 2
RESAMPLE_LANCZOS = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
TRANSPOSE_ROTATE_90 = getattr(getattr(Image, "Transpose", Image), "ROTATE_90")
TRANSPOSE_ROTATE_180 = getattr(getattr(Image, "Transpose", Image), "ROTATE_180")

# A standard one-sheet zine is a single landscape A4 printed on one side and
# folded into an eight page booklet. The sheet holds a 4x2 grid of panels and
# the top row is printed upside down, so reading it back means rotating that
# row 180 degrees.
#
# This is the usual template, with row 0 the top row of the sheet:
#
#   sheet:  page 6  page 5  page 4  page 3      (upside down)
#           back    front   page 1  page 2
#
# Numbering the front cover as 1 and the back cover as 8 gives the order below.
# Note the top row reads right to left, because rotating a pair such as
# (T3, T4) as a block puts T4 on the left. Facing pages therefore land on
# (B3, B4), (T4, T3) and (T2, T1), which is what keeps a photo drawn across two
# panels in one piece.
PAGE_CELLS = (
    (1, 1),  # 1, front cover
    (1, 2),  # 2
    (1, 3),  # 3
    (0, 3),  # 4
    (0, 2),  # 5
    (0, 1),  # 6
    (0, 0),  # 7
    (1, 0),  # 8, back cover
)
TOP_ROW = 0


def render_sheet(pdf_path: Path, page_number: int, target_dir: Path) -> Path:
    prefix = target_dir / "sheet"
    subprocess.run(
        [
            "pdftoppm",
            "-r",
            str(RENDER_DPI),
            "-f",
            str(page_number),
            "-l",
            str(page_number),
            "-png",
            str(pdf_path),
            str(prefix),
        ],
        check=True,
        capture_output=True,
    )

    rendered = sorted(target_dir.glob("sheet*.png"))
    if not rendered:
        raise FileNotFoundError(f"pdftoppm produced no page for {pdf_path}")
    return rendered[0]


def normalize_sheet(image: Image.Image) -> Image.Image:
    # Merging tools often tag the landscape sheet with /Rotate 90 so it prints
    # as portrait. Turn it back so the panel grid is always 4 columns by 2 rows.
    if image.height > image.width:
        return image.transpose(TRANSPOSE_ROTATE_90)
    return image


def trim_sheet_border(image: Image.Image, trim: int = SHEET_BORDER_TRIM) -> Image.Image:
    if trim <= 0:
        return image

    width, height = image.size
    if width <= trim * 2 or height <= trim * 2:
        return image

    return image.crop((trim, trim, width - trim, height - trim))


def cell_box(image: Image.Image, row: int, column: int) -> tuple[int, int, int, int]:
    width, height = image.size
    left = round(column * width / ZINE_COLUMNS)
    right = round((column + 1) * width / ZINE_COLUMNS)
    top = round(row * height / ZINE_ROWS)
    bottom = round((row + 1) * height / ZINE_ROWS)
    return left, top, right, bottom


def slice_pages(sheet: Image.Image) -> list[Image.Image]:
    pages = []
    for row, column in PAGE_CELLS:
        page = sheet.crop(cell_box(sheet, row, column))
        if row == TOP_ROW:
            page = page.transpose(TRANSPOSE_ROTATE_180)
        pages.append(page)
    return pages


def resize_to_width(image: Image.Image, max_width: int) -> Image.Image:
    if image.width <= max_width:
        return image

    height = max(1, round(image.height * max_width / image.width))
    return image.resize((max_width, height), RESAMPLE_LANCZOS)


def page_variant_name(slug: str, page_number: int, max_width: int, largest: int) -> str:
    # The media sync tooling works on flat directories, so the zine slug goes
    # in the file name instead of a folder per zine.
    if max_width == largest:
        return f"{slug}-p{page_number}.jpg"
    return f"{slug}-p{page_number}--w{max_width}.jpg"


def write_page(
    page: Image.Image,
    target_dir: Path,
    slug: str,
    page_number: int,
    *,
    max_widths: tuple[int, ...] = ZINE_VARIANT_MAX_WIDTHS,
    jpeg_quality: int,
) -> list[dict[str, object]]:
    target_dir.mkdir(parents=True, exist_ok=True)
    if page.mode not in {"RGB", "L"}:
        page = page.convert("RGB")

    largest = max_widths[-1]
    outputs: list[dict[str, object]] = []

    for max_width in max_widths:
        variant = resize_to_width(page, max_width)
        target_name = page_variant_name(slug, page_number, max_width, largest)
        target_path = target_dir / target_name
        with tempfile.NamedTemporaryFile(
            prefix=f"{slug}-p{page_number}-",
            suffix=".jpg",
            dir=target_dir,
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)
        try:
            variant.save(
                temp_path,
                format="JPEG",
                quality=jpeg_quality,
                optimize=True,
                progressive=True,
            )
            temp_path.replace(target_path)
        finally:
            if temp_path.exists():
                temp_path.unlink()

        outputs.append(
            {
                "name": target_name,
                "width": variant.width,
                "height": variant.height,
            }
        )

    outputs.sort(key=lambda item: int(item["width"]))
    return outputs


def printable_name(slug: str) -> str:
    return f"{slug}.pdf"


def copy_printable_pdf(
    pdf_path: Path, target_root: Path, slug: str
) -> dict[str, object]:
    # The sheet is meant to be printed and folded, so the reader offers the
    # original PDF rather than anything rebuilt from the page images.
    target_path = target_root / printable_name(slug)
    shutil.copyfile(pdf_path, target_path)
    return {"name": target_path.name, "bytes": target_path.stat().st_size}


def source_version(pdf_path: Path) -> str:
    stats = pdf_path.stat()
    return f"{PREPARE_VERSION}-{stats.st_mtime_ns}-{stats.st_size}"


def prepare_zine(
    entry: dict[str, object],
    source_root: Path,
    target_root: Path,
    *,
    jpeg_quality: int = 82,
) -> dict[str, object]:
    slug = str(entry["slug"])
    pdf_path = source_root / str(entry["source"])
    page_number = int(entry.get("page", 1))
    # Some zines ship a separate print file, for instance the version with the
    # back page merged in. It falls back to the sheet we slice.
    printable_path = source_root / str(entry.get("download") or entry["source"])

    if not pdf_path.exists():
        raise FileNotFoundError(f"Zine source not found: {pdf_path}")

    if not printable_path.exists():
        raise FileNotFoundError(f"Zine download not found: {printable_path}")

    target_root.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as work_dir:
        sheet_path = render_sheet(pdf_path, page_number, Path(work_dir))
        with Image.open(sheet_path) as rendered:
            sheet = trim_sheet_border(normalize_sheet(rendered.convert("RGB")))
            pages = slice_pages(sheet)

    page_payloads = []
    for index, page in enumerate(pages, start=1):
        sources = write_page(
            page,
            target_root,
            slug,
            index,
            jpeg_quality=jpeg_quality,
        )
        page_payloads.append({"number": index, "sources": sources})

    return {
        "slug": slug,
        "title": str(entry.get("title") or slug.replace("-", " ")),
        "version": source_version(pdf_path),
        "printable": copy_printable_pdf(printable_path, target_root, slug),
        "pages": page_payloads,
    }


def manifest_file_names(zines: list[dict[str, object]]) -> set[str]:
    names: set[str] = set()
    for zine in zines:
        printable = zine.get("printable")
        if isinstance(printable, dict) and printable.get("name"):
            names.add(str(printable["name"]))
        for page in zine["pages"]:
            for source in page["sources"]:
                names.add(str(source["name"]))
    return names


def prune_stale_pages(target_root: Path, keep: set[str]) -> list[str]:
    # The media sync uploads whatever sits in this directory, so dropping a
    # zine from the list has to drop its images too. Generated pages are never
    # hidden files, so leaving those alone protects .gitkeep and the manifest.
    removed = []
    for path in sorted(target_root.iterdir()):
        if not path.is_file() or path.name.startswith("."):
            continue
        if path.name not in keep:
            path.unlink()
            removed.append(path.name)
    return removed


def prepare_zine_set(
    entries: list[dict[str, object]],
    source_root: Path,
    target_root: Path,
    *,
    jpeg_quality: int = 82,
) -> dict[str, object]:
    target_root.mkdir(parents=True, exist_ok=True)
    zines = [
        prepare_zine(entry, source_root, target_root, jpeg_quality=jpeg_quality)
        for entry in entries
    ]
    prune_stale_pages(target_root, manifest_file_names(zines))
    return {"schema_version": 1, "zines": zines}


def save_zine_manifest(target_root: Path, payload: dict[str, object]) -> Path:
    manifest_path = target_root / ZINE_MANIFEST_NAME
    manifest_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest_path
