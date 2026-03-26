from __future__ import annotations

import os
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
UPLOAD_SCRIPT = ROOT / "scripts" / "upload-media.sh"


class UploadMediaScriptTests(unittest.TestCase):
    def make_fake_fly(self, bin_dir: Path, uploads_dir: Path, args_path: Path, stdin_path: Path, sources_path: Path) -> None:
        fly_path = bin_dir / "fly"
        fly_path.write_text(
            textwrap.dedent(
                f"""\
                #!/usr/bin/env bash
                set -euo pipefail
                printf '%s\n' "$@" > "{args_path}"
                : > "{stdin_path}"
                : > "{sources_path}"
                while IFS= read -r line; do
                  printf '%s\n' "$line" >> "{stdin_path}"
                  set -- $line
                  if [[ "${{1:-}}" == "put" && -n "${{2:-}}" ]]; then
                    printf '%s\n' "$2" >> "{sources_path}"
                    cp "$2" "{uploads_dir}/$(basename "$2")"
                  fi
                done
                """
            ),
            encoding="utf-8",
        )
        fly_path.chmod(fly_path.stat().st_mode | stat.S_IXUSR)

    def run_upload(self, kind: str, local_path: Path) -> tuple[subprocess.CompletedProcess[str], Path, Path]:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        temp_root = Path(temp_dir.name)
        bin_dir = temp_root / "bin"
        uploads_dir = temp_root / "uploads"
        args_path = temp_root / "fly-args.txt"
        stdin_path = temp_root / "fly-stdin.txt"
        sources_path = temp_root / "fly-sources.txt"
        bin_dir.mkdir()
        uploads_dir.mkdir()

        self.make_fake_fly(bin_dir, uploads_dir, args_path, stdin_path, sources_path)

        env = os.environ.copy()
        env["PATH"] = f"{bin_dir}:{env['PATH']}"

        result = subprocess.run(
            ["bash", str(UPLOAD_SCRIPT), "manturon", kind, str(local_path)],
            cwd=ROOT,
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

        return result, uploads_dir, sources_path

    def test_upload_media_optimizes_single_photo_before_uploading(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            photo_path = Path(temp_dir) / "foto.jpg"
            Image.new("RGB", (5000, 3200), color=(120, 40, 20)).save(photo_path, quality=100)
            original_size = photo_path.stat().st_size

            result, uploads_dir, sources_path = self.run_upload("photos", photo_path)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Preparing a web copy of the photo...", result.stdout)

        uploaded_photo = uploads_dir / "foto.jpg"
        self.assertTrue(uploaded_photo.exists())
        self.assertLess(uploaded_photo.stat().st_size, original_size)

        with Image.open(uploaded_photo) as image:
            self.assertLessEqual(max(image.size), 2200)

        uploaded_source = sources_path.read_text(encoding="utf-8").strip()
        self.assertNotEqual(uploaded_source, str(photo_path))

    def test_upload_media_keeps_music_file_without_transforming_it(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            track_path = Path(temp_dir) / "tema.mp3"
            track_path.write_bytes(b"fake mp3 data")

            result, uploads_dir, sources_path = self.run_upload("music", track_path)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((uploads_dir / "tema.mp3").read_bytes(), b"fake mp3 data")
        self.assertEqual(sources_path.read_text(encoding="utf-8").strip(), str(track_path))


if __name__ == "__main__":
    unittest.main()
