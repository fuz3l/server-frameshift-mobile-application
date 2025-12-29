import json
import re
from pathlib import Path
from typing import Dict
from ..utils.file_handler import FileHandler
from ..utils.logger import logger


class URLsConverter:
    """Convert Django URL patterns to Flask routes"""

    def __init__(self, django_path: str, output_path: str):
        self.django_path = Path(django_path)
        self.output_path = Path(output_path)
        self.rules = self._load_rules()
        self.results = {
            'converted_files': [],
            'total_patterns': 0,
            'issues': [],
            'warnings': []
        }

    def _load_rules(self) -> Dict:
        """Load conversion rules from JSON"""
        rules_path = Path(__file__).parent.parent / 'rules' / 'urls_rules.json'
        with open(rules_path, 'r') as f:
            return json.load(f)

    def convert(self) -> Dict:
        """Convert all Django URL configurations to Flask"""
        logger.info("Starting URLs conversion")

        url_files = FileHandler.find_files(str(self.django_path), 'urls.py')
        url_files = [f for f in url_files if '__pycache__' not in str(f)]

        for url_file in url_files:
            try:
                result = self._convert_file(url_file)
                self.results['converted_files'].append(result)

                # Add per-file conversion detail for frontend display
                self.results['issues'].append({
                    'file': str(url_file.relative_to(self.django_path)),
                    'filename': url_file.name,
                    'status': 'converted',
                    'confidence': 85,  # Good confidence for URL conversion
                    'message': f'URLs converted to Flask routes (output: routes.py)',
                    'description': 'Django URL patterns converted to Flask blueprints',
                    'category': 'urls'
                })
            except Exception as e:
                logger.error(f"Failed to convert {url_file}: {e}")
                self.results['issues'].append({
                    'file': str(url_file.relative_to(self.django_path)),
                    'filename': url_file.name,
                    'status': 'failed',
                    'confidence': 0,
                    'message': f'Conversion failed: {str(e)}',
                    'description': str(e),
                    'category': 'urls',
                    'error': str(e)
                })

        logger.info(f"URLs conversion complete. Total patterns: {self.results['total_patterns']}")
        return self.results

    def _convert_file(self, file_path: Path) -> Dict:
        """Convert a single Django urls.py file"""
        logger.info(f"Converting URLs file: {file_path}")

        source_code = FileHandler.read_file(str(file_path))
        converted_code = self._convert_urls_code(source_code)

        # Calculate output path
        relative_path = file_path.relative_to(self.django_path)
        output_file = self.output_path / relative_path.parent / 'routes.py'

        # Write converted code
        FileHandler.write_file(str(output_file), converted_code)

        return {
            'file': str(file_path),
            'output': str(output_file),
            'success': True,
            'note': 'URLs converted to Flask routes/blueprints'
        }

    def _convert_urls_code(self, code: str) -> str:
        """Convert Django URL patterns to Flask routes"""

        converted_lines = []
        converted_lines.append('# Converted from Django URLs to Flask routes')
        converted_lines.append('# This file shows the URL patterns - integrate with views.py')
        converted_lines.append('')
        converted_lines.append('from flask import Blueprint')
        converted_lines.append('')
        converted_lines.append('# Create blueprint')
        converted_lines.append('bp = Blueprint("main", __name__)')
        converted_lines.append('')

        # Extract path() and re_path() patterns
        path_patterns = re.findall(r"path\(['\"]([^'\"]+)['\"],\s*(\w+)\.?(\w+)?", code)
        re_path_patterns = re.findall(r"re_path\(r['\"]([^'\"]+)['\"],\s*(\w+)\.?(\w+)?", code)

        # Convert path() patterns
        for pattern, module, view in path_patterns:
            flask_route = self._convert_path_pattern(pattern)
            view_name = view if view else module

            converted_lines.append(f"@bp.route('{flask_route}')")
            converted_lines.append(f"def {view_name}():")
            converted_lines.append(f"    # Implement {view_name} view")
            converted_lines.append("    pass")
            converted_lines.append("")

            self.results['total_patterns'] += 1

        # Convert re_path() patterns
        for pattern, module, view in re_path_patterns:
            flask_route = self._convert_regex_pattern(pattern)
            view_name = view if view else module

            converted_lines.append(f"# Regex pattern: {pattern}")
            converted_lines.append(f"@bp.route('{flask_route}')")
            converted_lines.append(f"def {view_name}():")
            converted_lines.append(f"    # Implement {view_name} view")
            converted_lines.append("    pass")
            converted_lines.append("")

            self.results['total_patterns'] += 1

        # Add warning if include() is used
        if 'include(' in code:
            converted_lines.insert(3, '# WARNING: include() patterns found - create separate blueprints')
            self.results['warnings'].append({
                'type': 'include_patterns',
                'message': 'URL include() patterns should be converted to Flask Blueprints'
            })

        return '\n'.join(converted_lines)

    def _convert_path_pattern(self, pattern: str) -> str:
        """Convert Django path pattern to Flask route"""
        # Simple conversion - can be enhanced
        flask_pattern = pattern

        # Convert trailing slash
        if not flask_pattern.endswith('/'):
            flask_pattern += '/'

        # Add leading slash
        if not flask_pattern.startswith('/'):
            flask_pattern = '/' + flask_pattern

        return flask_pattern

    def _convert_regex_pattern(self, pattern: str) -> str:
        """Convert Django regex pattern to Flask route with converters"""

        # Common conversions
        conversions = {
            r'\^': '',  # Remove start anchor
            r'\$': '',  # Remove end anchor
            r'(?P<pk>[0-9]+)': '<int:pk>',
            r'(?P<id>[0-9]+)': '<int:id>',
            r'(?P<slug>[-\w]+)': '<string:slug>',
            r'(?P<username>[\w.@+-]+)': '<string:username>',
        }

        flask_pattern = pattern
        for django_regex, flask_conv in conversions.items():
            flask_pattern = flask_pattern.replace(django_regex, flask_conv)

        # Add slashes if needed
        if not flask_pattern.startswith('/'):
            flask_pattern = '/' + flask_pattern
        if not flask_pattern.endswith('/'):
            flask_pattern += '/'

        return flask_pattern


__all__ = ['URLsConverter']
