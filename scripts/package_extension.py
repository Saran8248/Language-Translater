"""
Packaging utility for Universal Translator Chrome Extension.
Creates a clean, production-ready ZIP archive for Chrome Web Store submission.
"""
import os
import json
import zipfile
from pathlib import Path

def package():
    root_dir = Path(__file__).resolve().parent.parent
    extension_dir = root_dir / "extension"
    dist_dir = root_dir / "dist"
    dist_dir.mkdir(exist_ok=True)

    manifest_path = extension_dir / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Missing manifest.json at {manifest_path}")

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    name = manifest.get("name", "universal-translator").lower().replace(" ", "-")
    version = manifest.get("version", "1.0.0")
    zip_filename = f"{name}-v{version}.zip"
    zip_path = dist_dir / zip_filename

    print(f"Packaging {manifest['name']} v{version}...")

    # Required files check
    required_files = [
        "manifest.json",
        "background.js",
        "content.js",
        "content.css",
        "popup.html",
        "popup.css",
        "popup.js",
        "icons/icon16.png",
        "icons/icon32.png",
        "icons/icon48.png",
        "icons/icon128.png"
    ]

    for req in required_files:
        p = extension_dir / req
        if not p.exists():
            raise FileNotFoundError(f"Required extension file missing: {req}")

    # Create ZIP archive
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(extension_dir):
            for file in files:
                # Ignore system metadata files
                if file.startswith(".") or file in ("Thumbs.db", ".DS_Store"):
                    continue
                file_path = Path(root) / file
                archive_name = file_path.relative_to(extension_dir)
                zf.write(file_path, archive_name)
                print(f"  + Added: {archive_name}")

    file_size_kb = zip_path.stat().st_size / 1024
    print(f"\nSuccessfully generated distribution package:")
    print(f"  Archive: {zip_path}")
    print(f"  Size: {file_size_kb:.2f} KB")

if __name__ == "__main__":
    package()
