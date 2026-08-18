from __future__ import annotations

import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = str(ROOT / "scripts")
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

import zine_prepare  # noqa: E402

MODULE_PATH = ROOT / "scripts" / "prepare-zines.py"
SPEC = importlib.util.spec_from_file_location("prepare_zines", MODULE_PATH)
prepare_zines = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(prepare_zines)

HAS_PDFTOPPM = shutil.which("pdftoppm") is not None

# One flat colour per panel, laid out as the sheet is printed.
CELL_COLOURS = {
    (0, 0): (10, 10, 10),
    (0, 1): (30, 30, 30),
    (0, 2): (50, 50, 50),
    (0, 3): (70, 70, 70),
    (1, 0): (90, 90, 90),
    (1, 1): (110, 110, 110),
    (1, 2): (130, 130, 130),
    (1, 3): (150, 150, 150),
}


def build_sheet(width: int = 800, height: int = 600) -> Image.Image:
    sheet = Image.new("RGB", (width, height), (0, 0, 0))
    for (row, column), colour in CELL_COLOURS.items():
        box = zine_prepare.cell_box(sheet, row, column)
        sheet.paste(Image.new("RGB", (box[2] - box[0], box[3] - box[1]), colour), box)
    return sheet


def marked_sheet(width: int = 800, height: int = 600) -> Image.Image:
    """A sheet whose top row carries a bright dot near its top-left corner."""
    sheet = build_sheet(width, height)
    for (row, column), _ in CELL_COLOURS.items():
        if row != zine_prepare.TOP_ROW:
            continue
        left, top, _, _ = zine_prepare.cell_box(sheet, row, column)
        sheet.paste(Image.new("RGB", (12, 12), (255, 0, 0)), (left + 4, top + 4))
    return sheet


class SliceTests(unittest.TestCase):
    def test_cell_box_splits_the_sheet_into_four_by_two(self) -> None:
        sheet = Image.new("RGB", (800, 600))

        self.assertEqual(zine_prepare.cell_box(sheet, 0, 0), (0, 0, 200, 300))
        self.assertEqual(zine_prepare.cell_box(sheet, 1, 3), (600, 300, 800, 600))

    def test_slice_pages_follows_the_standard_fold_order(self) -> None:
        pages = zine_prepare.slice_pages(build_sheet())

        self.assertEqual(len(pages), zine_prepare.ZINE_PAGE_COUNT)
        # Front cover is the second panel of the bottom row, back cover the
        # first, and the top row reads right to left.
        expected = [CELL_COLOURS[cell] for cell in zine_prepare.PAGE_CELLS]
        self.assertEqual([page.getpixel((5, 5)) for page in pages], expected)

    def test_slice_pages_turns_the_top_row_the_right_way_up(self) -> None:
        pages = zine_prepare.slice_pages(marked_sheet())

        # The mark sits top-left on the sheet; after the 180 degree turn it has
        # to come out bottom-right on the page.
        for index, (row, _) in enumerate(zine_prepare.PAGE_CELLS):
            page = pages[index]
            if row != zine_prepare.TOP_ROW:
                continue

            self.assertEqual(
                page.getpixel((page.width - 10, page.height - 10)), (255, 0, 0)
            )
            self.assertNotEqual(page.getpixel((10, 10)), (255, 0, 0))

    def test_facing_pages_come_from_neighbouring_panels(self) -> None:
        # Pages 2-3, 4-5 and 6-7 face each other in the folded booklet, so each
        # pair has to be adjacent on the sheet or a photo across both is cut.
        for left, right in ((2, 3), (4, 5), (6, 7)):
            left_row, left_column = zine_prepare.PAGE_CELLS[left - 1]
            right_row, right_column = zine_prepare.PAGE_CELLS[right - 1]

            self.assertEqual(left_row, right_row)
            self.assertEqual(abs(left_column - right_column), 1)

    def test_normalize_sheet_turns_a_portrait_render_back_to_landscape(self) -> None:
        portrait = Image.new("RGB", (600, 800))
        landscape = Image.new("RGB", (800, 600))

        self.assertEqual(zine_prepare.normalize_sheet(portrait).size, (800, 600))
        self.assertEqual(zine_prepare.normalize_sheet(landscape).size, (800, 600))

    def test_trim_sheet_border_drops_the_cut_guides(self) -> None:
        sheet = Image.new("RGB", (800, 600))

        self.assertEqual(zine_prepare.trim_sheet_border(sheet, 3).size, (794, 594))
        self.assertEqual(zine_prepare.trim_sheet_border(sheet, 0).size, (800, 600))
        # Refuse to trim away an image that is smaller than the border.
        self.assertEqual(
            zine_prepare.trim_sheet_border(Image.new("RGB", (4, 4)), 3).size, (4, 4)
        )


class PageOutputTests(unittest.TestCase):
    def test_resize_to_width_never_upscales(self) -> None:
        image = Image.new("RGB", (400, 800))

        self.assertEqual(zine_prepare.resize_to_width(image, 200).size, (200, 400))
        self.assertEqual(zine_prepare.resize_to_width(image, 900).size, (400, 800))

    def test_page_variant_name_keeps_the_slug_in_the_file_name(self) -> None:
        self.assertEqual(
            zine_prepare.page_variant_name("la-tormenta", 3, 1520, 1520),
            "la-tormenta-p3.jpg",
        )
        self.assertEqual(
            zine_prepare.page_variant_name("la-tormenta", 3, 440, 1520),
            "la-tormenta-p3--w440.jpg",
        )

    def test_write_page_emits_every_variant_sorted_by_width(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir)
            sources = zine_prepare.write_page(
                Image.new("RGB", (877, 1240), (20, 20, 20)),
                target,
                "zine",
                1,
                max_widths=(440, 1520),
                jpeg_quality=82,
            )

            self.assertEqual(
                [source["name"] for source in sources],
                ["zine-p1--w440.jpg", "zine-p1.jpg"],
            )
            self.assertEqual([source["width"] for source in sources], [440, 877])
            for source in sources:
                self.assertTrue((target / str(source["name"])).exists())
            # No temporary files left behind.
            self.assertEqual(len(list(target.iterdir())), 2)

    def test_write_page_converts_modes_jpeg_cannot_store(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            sources = zine_prepare.write_page(
                Image.new("RGBA", (100, 140)),
                Path(temp_dir),
                "zine",
                2,
                max_widths=(50,),
                jpeg_quality=70,
            )

        self.assertEqual(sources[0]["name"], "zine-p2.jpg")


class ManifestTests(unittest.TestCase):
    def test_source_version_changes_with_the_prepare_version(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            pdf = Path(temp_dir) / "zine.pdf"
            pdf.write_bytes(b"pdf")

            version = zine_prepare.source_version(pdf)

        self.assertTrue(version.startswith(f"{zine_prepare.PREPARE_VERSION}-"))
        self.assertTrue(version.endswith("-3"))

    def test_prune_stale_pages_removes_files_outside_the_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir)
            (target / "keep-p1.jpg").write_text("x")
            (target / "drop-p1.jpg").write_text("x")
            (target / zine_prepare.ZINE_MANIFEST_NAME).write_text("{}")
            (target / ".gitkeep").write_text("")

            zines = [{"pages": [{"sources": [{"name": "keep-p1.jpg"}]}]}]
            removed = zine_prepare.prune_stale_pages(
                target, zine_prepare.manifest_file_names(zines)
            )

            self.assertEqual(removed, ["drop-p1.jpg"])
            self.assertTrue((target / "keep-p1.jpg").exists())
            # Hidden files are left alone, so the folder stays in git and the
            # manifest survives a rerun.
            self.assertTrue((target / zine_prepare.ZINE_MANIFEST_NAME).exists())
            self.assertTrue((target / ".gitkeep").exists())

    def test_save_zine_manifest_writes_readable_json(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir)
            path = zine_prepare.save_zine_manifest(
                target, {"schema_version": 1, "zines": []}
            )

            self.assertEqual(path.name, zine_prepare.ZINE_MANIFEST_NAME)
            self.assertEqual(
                json.loads(path.read_text(encoding="utf-8")),
                {"schema_version": 1, "zines": []},
            )

    def test_prepare_zine_rejects_a_missing_source(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaises(FileNotFoundError):
                zine_prepare.prepare_zine(
                    {"slug": "nope", "source": "nope.pdf"},
                    Path(temp_dir),
                    Path(temp_dir) / "out",
                )

    def test_render_sheet_complains_when_nothing_is_produced(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with mock.patch.object(zine_prepare.subprocess, "run"):
                with self.assertRaises(FileNotFoundError):
                    zine_prepare.render_sheet(Path("zine.pdf"), 1, Path(temp_dir))


@unittest.skipUnless(HAS_PDFTOPPM, "pdftoppm is not installed")
class EndToEndTests(unittest.TestCase):
    def build_pdf(self, path: Path, sheet: Image.Image) -> None:
        sheet.save(path, format="PDF", resolution=72.0)

    def test_prepare_zine_set_slices_a_sheet_into_eight_pages(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source_root = Path(temp_dir) / "src"
            target_root = Path(temp_dir) / "out"
            source_root.mkdir()
            self.build_pdf(source_root / "zine.pdf", build_sheet(1600, 1131))

            payload = zine_prepare.prepare_zine_set(
                [{"slug": "zine", "title": "un zine", "source": "zine.pdf"}],
                source_root,
                target_root,
                jpeg_quality=70,
            )

            self.assertEqual(payload["schema_version"], 1)
            self.assertEqual(len(payload["zines"]), 1)

            zine = payload["zines"][0]
            self.assertEqual(zine["title"], "un zine")
            self.assertEqual(len(zine["pages"]), 8)
            self.assertEqual(
                [page["number"] for page in zine["pages"]], list(range(1, 9))
            )

            for page in zine["pages"]:
                for source in page["sources"]:
                    self.assertTrue((target_root / str(source["name"])).exists())

    def test_cli_writes_a_manifest_for_the_configured_zines(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source_root = Path(temp_dir) / "src"
            target_root = Path(temp_dir) / "out"
            source_root.mkdir()
            self.build_pdf(source_root / "zine.pdf", build_sheet(1600, 1131))

            config = Path(temp_dir) / "zines.json"
            config.write_text(
                json.dumps(
                    [{"slug": "zine", "title": "un zine", "source": "zine.pdf"}]
                ),
                encoding="utf-8",
            )

            with mock.patch(
                "sys.argv",
                [
                    "prepare-zines.py",
                    str(source_root),
                    str(target_root),
                    "--config",
                    str(config),
                    "--jpeg-quality",
                    "70",
                ],
            ):
                self.assertEqual(prepare_zines.main(), 0)

            manifest = json.loads(
                (target_root / zine_prepare.ZINE_MANIFEST_NAME).read_text("utf-8")
            )
            self.assertEqual(manifest["zines"][0]["slug"], "zine")

    def test_prepare_zine_normalizes_a_rotated_sheet(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source_root = Path(temp_dir) / "src"
            target_root = Path(temp_dir) / "out"
            source_root.mkdir()
            # Saved portrait, the way a merge tool leaves the sheet.
            self.build_pdf(
                source_root / "zine.pdf",
                build_sheet(1600, 1131).transpose(zine_prepare.TRANSPOSE_ROTATE_90),
            )

            zine = zine_prepare.prepare_zine(
                {"slug": "zine", "source": "zine.pdf"},
                source_root,
                target_root,
                jpeg_quality=70,
            )

            self.assertEqual(len(zine["pages"]), 8)
            cover = target_root / str(zine["pages"][0]["sources"][-1]["name"])
            with Image.open(cover) as image:
                # Pages are taller than they are wide once the sheet is right.
                self.assertGreater(image.height, image.width)


class CliArgumentTests(unittest.TestCase):
    def test_main_reports_a_missing_source_directory(self) -> None:
        with mock.patch("sys.argv", ["prepare-zines.py", "/tmp/no-such-zine-dir"]):
            self.assertEqual(prepare_zines.main(), 1)

    def test_main_reports_a_missing_config(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with mock.patch(
                "sys.argv",
                [
                    "prepare-zines.py",
                    temp_dir,
                    temp_dir,
                    "--config",
                    str(Path(temp_dir) / "nope.json"),
                ],
            ):
                self.assertEqual(prepare_zines.main(), 1)

    def test_main_stops_on_an_empty_list(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = Path(temp_dir) / "zines.json"
            config.write_text("[]", encoding="utf-8")

            with mock.patch(
                "sys.argv",
                ["prepare-zines.py", temp_dir, temp_dir, "--config", str(config)],
            ):
                self.assertEqual(prepare_zines.main(), 0)

    def test_load_entries_rejects_a_non_list(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = Path(temp_dir) / "zines.json"
            config.write_text('{"slug": "zine"}', encoding="utf-8")

            with self.assertRaises(ValueError):
                prepare_zines.load_entries(config)


if __name__ == "__main__":
    unittest.main()
