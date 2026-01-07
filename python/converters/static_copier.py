"""
Static Files Copier
Copies Django static files to Flask static directory
"""

import shutil
from pathlib import Path
from typing import Dict, List
from ..utils.logger import logger


class StaticCopier:
    """Copy static files from Django to Flask project"""

    def __init__(self, django_path: str, output_path: str):
        self.django_path = Path(django_path)
        self.output_path = Path(output_path)
        self.results = {
            'copied_files': [],
            'total_static_files': 0,
            'total_size_bytes': 0,
            'issues': [],
            'warnings': []
        }

    def copy(self) -> Dict:
        """Copy all static files to Flask static/ directory"""
        logger.info("Starting static files copy")

        # Find all static directories in Django project
        static_dirs = self._find_static_directories()

        if not static_dirs:
            logger.warning("No static directories found")
            return self.results

        # Create Flask static directory
        flask_static_dir = self.output_path / 'static'
        flask_static_dir.mkdir(parents=True, exist_ok=True)

        # Copy all static files
        for static_dir in static_dirs:
            self._copy_directory(static_dir, flask_static_dir)

        logger.info(f"Static files copy complete. Copied {self.results['total_static_files']} files ({self.results['total_size_bytes']} bytes)")
        return self.results

    def _find_static_directories(self) -> List[Path]:
        """Find all 'static' directories in Django project"""
        static_dirs = []

        # Common locations for static files in Django
        for item in self.django_path.rglob('static'):
            if item.is_dir():
                static_dirs.append(item)
                logger.info(f"Found static directory: {item}")

        return static_dirs

    def _copy_directory(self, source_dir: Path, dest_dir: Path):
        """Recursively copy a static directory"""
        try:
            for item in source_dir.rglob('*'):
                if item.is_file():
                    # Calculate relative path from source static dir
                    relative_path = item.relative_to(source_dir)

                    # Determine destination
                    dest_file = dest_dir / relative_path

                    # Create parent directories
                    dest_file.parent.mkdir(parents=True, exist_ok=True)

                    # Copy file
                    shutil.copy2(item, dest_file)

                    # Track results
                    file_size = item.stat().st_size
                    self.results['copied_files'].append({
                        'source': str(item),
                        'destination': str(dest_file),
                        'size': file_size
                    })
                    self.results['total_static_files'] += 1
                    self.results['total_size_bytes'] += file_size

                    logger.debug(f"Copied: {relative_path}")

        except Exception as e:
            logger.error(f"Error copying {source_dir}: {e}")
            self.results['issues'].append({
                'directory': str(source_dir),
                'error': str(e)
            })


__all__ = ['StaticCopier']
