import json
from pathlib import Path
from typing import Dict
from ..utils.file_handler import FileHandler
from ..utils.logger import logger


class TemplatesConverter:
    """Convert Django templates to Jinja2 (Flask) templates"""

    def __init__(self, django_path: str, output_path: str):
        self.django_path = Path(django_path)
        self.output_path = Path(output_path)
        self.rules = self._load_rules()
        self.results = {
            'converted_files': [],
            'total_templates': 0,
            'issues': [],
            'warnings': []
        }

    def _load_rules(self) -> Dict:
        """Load conversion rules from JSON"""
        rules_path = Path(__file__).parent.parent / 'rules' / 'templates_rules.json'
        with open(rules_path, 'r') as f:
            return json.load(f)

    def convert(self) -> Dict:
        """Convert all Django templates to Jinja2"""
        logger.info("Starting templates conversion")

        # Find all HTML templates
        template_files = FileHandler.find_files(str(self.django_path), '*.html')

        for template_file in template_files:
            try:
                result = self._convert_file(template_file)
                self.results['converted_files'].append(result)
                self.results['total_templates'] += 1

                # Add per-file conversion detail for frontend display
                self.results['issues'].append({
                    'file': str(template_file.relative_to(self.django_path)),
                    'filename': template_file.name,
                    'status': 'converted',
                    'confidence': 80,  # Moderate confidence - templates may need manual review
                    'message': 'Template converted to Jinja2',
                    'description': 'Django template tags converted to Jinja2 syntax',
                    'category': 'templates'
                })
            except Exception as e:
                logger.error(f"Failed to convert {template_file}: {e}")
                self.results['issues'].append({
                    'file': str(template_file.relative_to(self.django_path)),
                    'filename': template_file.name,
                    'status': 'failed',
                    'confidence': 0,
                    'message': f'Conversion failed: {str(e)}',
                    'description': str(e),
                    'category': 'templates',
                    'error': str(e)
                })

        logger.info(f"Templates conversion complete. Converted {self.results['total_templates']} templates")
        return self.results

    def _convert_file(self, file_path: Path) -> Dict:
        """Convert a single Django template file"""
        logger.debug(f"Converting template: {file_path}")

        source_code = FileHandler.read_file(str(file_path))
        converted_code = self._convert_template_code(source_code)

        # Calculate output path - preserve directory structure
        # Templates go into templates/ directory, maintaining app structure
        relative_path = file_path.relative_to(self.django_path)

        # Try to preserve the app/templates structure if it exists
        parts = relative_path.parts
        if 'templates' in parts:
            # Find templates directory and keep everything after it
            templates_idx = parts.index('templates')
            output_file = self.output_path / Path(*parts[templates_idx:])
        else:
            # No templates directory in path, just put in templates/
            output_file = self.output_path / 'templates' / relative_path.name

        # Write converted code
        FileHandler.write_file(str(output_file), converted_code)

        return {
            'file': str(file_path),
            'output': str(output_file),
            'success': True
        }

    def _convert_template_code(self, code: str) -> str:
        """Convert Django template syntax to Jinja2"""

        converted = code

        # Convert {% load static %}
        if '{% load static %}' in converted:
            converted = converted.replace('{% load static %}', '<!-- Flask uses url_for("static", filename="...") -->')

        # Convert {% static 'path' %}
        converted = converted.replace("{% static '", "{{ url_for('static', filename='")
        converted = converted.replace("{% static \"", "{{ url_for('static', filename=\"")
        converted = converted.replace("' %}", "') }}")
        converted = converted.replace("\" %}", "\") }}")

        # Convert {% url 'view_name' %}
        import re
        url_pattern = re.compile(r"{%\s*url\s+'([^']+)'\s*%}")
        converted = url_pattern.sub(r"{{ url_for('\1') }}", converted)

        # Convert {% csrf_token %}
        converted = converted.replace('{% csrf_token %}', '{{ csrf_token() }}')

        # Django-specific template tags that need manual conversion
        if '{% load ' in converted:
            self.results['warnings'].append({
                'type': 'template_tags',
                'message': 'Custom template tags found - need manual conversion or Flask extension'
            })

        # Add comment at top
        if converted and not converted.startswith('<!--'):
            converted = '<!-- Converted from Django template to Jinja2 (Flask) -->\n' + converted

        return converted


__all__ = ['TemplatesConverter']
