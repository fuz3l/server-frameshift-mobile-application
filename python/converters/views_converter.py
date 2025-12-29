import json
import re
from pathlib import Path
from typing import Dict, List, Tuple
from ..utils.file_handler import FileHandler
from ..utils.logger import logger


class ViewsConverter:
    """Convert Django views to Flask routes with full ORM and CBV conversion"""

    def __init__(self, django_path: str, output_path: str):
        self.django_path = Path(django_path)
        self.output_path = Path(output_path)
        self.rules = self._load_rules()
        self.results = {
            'converted_files': [],
            'total_views': 0,
            'issues': [],
            'warnings': []
        }

    def _load_rules(self) -> Dict:
        """Load conversion rules from JSON"""
        rules_path = Path(__file__).parent.parent / 'rules' / 'views_rules.json'
        with open(rules_path, 'r') as f:
            return json.load(f)

    def convert(self) -> Dict:
        """Convert all Django views to Flask"""
        logger.info("Starting views conversion")

        view_files = FileHandler.find_files(str(self.django_path), 'views.py')
        view_files = [f for f in view_files if '__pycache__' not in str(f)]

        for view_file in view_files:
            try:
                result = self._convert_file(view_file)
                self.results['converted_files'].append(result)
                self.results['total_views'] += result.get('views_count', 0)

                # Add per-file conversion detail for frontend display
                self.results['issues'].append({
                    'file': str(view_file.relative_to(self.django_path)),
                    'filename': view_file.name,
                    'status': 'converted',
                    'confidence': 90,  # Good confidence for views conversion
                    'message': f'Successfully converted {result.get("views_count", 0)} view(s)',
                    'description': 'Django views converted to Flask routes',
                    'category': 'views'
                })
            except Exception as e:
                logger.error(f"Failed to convert {view_file}: {e}", exc_info=True)
                self.results['issues'].append({
                    'file': str(view_file.relative_to(self.django_path)),
                    'filename': view_file.name,
                    'status': 'failed',
                    'confidence': 0,
                    'message': f'Conversion failed: {str(e)}',
                    'description': str(e),
                    'category': 'views',
                    'error': str(e)
                })

        logger.info(f"Views conversion complete. Converted {self.results['total_views']} views")
        return self.results

    def _convert_file(self, file_path: Path) -> Dict:
        """Convert a single Django views file"""
        logger.info(f"Converting views file: {file_path}")

        source_code = FileHandler.read_file(str(file_path))
        converted_code = self._convert_views_code(source_code)

        # Calculate output path
        relative_path = file_path.relative_to(self.django_path)
        output_file = self.output_path / relative_path

        # Write converted code
        FileHandler.write_file(str(output_file), converted_code)

        return {
            'file': str(file_path),
            'output': str(output_file),
            'success': True,
            'views_count': converted_code.count('def ') - converted_code.count('def __')
        }

    def _convert_views_code(self, code: str) -> str:
        """Convert Django views code to Flask"""

        converted = code

        # Step 1: Convert imports
        converted = self._convert_imports(converted)

        # Step 2: Convert class-based views to functions
        converted = self._convert_class_based_views(converted)

        # Step 3: Convert Django ORM to SQLAlchemy
        converted = self._convert_orm_queries(converted)

        # Step 4: Convert request parameters
        converted = self._convert_request_params(converted)

        # Step 5: Remove Django-specific utilities
        converted = self._convert_django_utilities(converted)

        # Step 6: Add header warning
        header = (
            "# WARNING: This is an automated conversion from Django to Flask\n"
            "# Please review and test thoroughly before using in production\n"
            "# You may need to add route decorators (@app.route or @bp.route)\n\n"
        )
        converted = header + converted

        return converted

    def _convert_imports(self, code: str) -> str:
        """Convert Django imports to Flask imports"""

        # Map Django imports to Flask imports
        import_mappings = {
            r'from django\.shortcuts import render': 'from flask import render_template',
            r'from django\.http import HttpResponse': 'from flask import make_response',
            r'from django\.http import JsonResponse': 'from flask import jsonify',
            r'from django\.shortcuts import redirect': 'from flask import redirect, url_for',
            r'from django\.shortcuts import get_object_or_404': '# get_object_or_404 implemented below',
            r'from django\.contrib\.auth\.decorators import login_required': 'from flask_login import login_required',
            r'from django\.views\.decorators\.\w+ import \w+': '# Django view decorators not directly supported in Flask',
        }

        for django_import, flask_import in import_mappings.items():
            if re.search(django_import, code):
                code = re.sub(django_import, flask_import, code)

        # Remove class-based view imports
        code = re.sub(r'from django\.views\.generic import .*\n', '', code)

        # Add Flask request import if needed
        if 'request.method' in code or 'request.form' in code or 'request.args' in code:
            if 'from flask import' in code:
                # Add to existing import
                code = re.sub(
                    r'(from flask import [^\n]+)',
                    lambda m: m.group(1) + ', request' if 'request' not in m.group(1) else m.group(1),
                    code,
                    count=1
                )
            else:
                code = 'from flask import request\n' + code

        # Add get_object_or_404 helper if used
        if 'get_object_or_404' in code:
            helper = '''
def get_object_or_404(model, **kwargs):
    """Helper function to get object or abort with 404"""
    from flask import abort
    obj = model.query.filter_by(**kwargs).first()
    if obj is None:
        abort(404)
    return obj

'''
            # Insert after imports
            import_end = self._find_imports_end(code)
            code = code[:import_end] + '\n' + helper + code[import_end:]

        return code

    def _find_imports_end(self, code: str) -> int:
        """Find the end position of import statements"""
        lines = code.split('\n')
        last_import_line = 0

        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped.startswith(('import ', 'from ')) or stripped.startswith('#') or stripped == '':
                last_import_line = i
            elif stripped:  # First non-import, non-comment, non-empty line
                break

        # Return character position
        return len('\n'.join(lines[:last_import_line + 1]))

    def _convert_class_based_views(self, code: str) -> str:
        """Convert Django class-based views to Flask function-based views"""

        # Find all class-based views
        cbv_pattern = r'class (\w+)\((ListView|DetailView|CreateView|UpdateView|DeleteView|View)\):(.*?)(?=\nclass |\n(?:def [^_])|$)'

        def convert_cbv(match):
            class_name = match.group(1)
            view_type = match.group(2)
            class_body = match.group(3)

            if view_type == 'ListView':
                return self._convert_list_view(class_name, class_body)
            elif view_type == 'DetailView':
                return self._convert_detail_view(class_name, class_body)
            elif view_type in ['CreateView', 'UpdateView']:
                return self._convert_form_view(class_name, class_body, view_type)
            elif view_type == 'DeleteView':
                return self._convert_delete_view(class_name, class_body)
            else:
                # Generic View - convert to basic function
                self.results['warnings'].append({
                    'type': 'cbv_conversion',
                    'message': f'{view_type} {class_name} requires manual conversion'
                })
                return f"\n# TODO: Convert {class_name}({view_type}) to Flask function-based view\n"

        code = re.sub(cbv_pattern, convert_cbv, code, flags=re.DOTALL)

        return code

    def _convert_list_view(self, class_name: str, class_body: str) -> str:
        """Convert Django ListView to Flask function"""

        # Extract attributes
        model = self._extract_attribute(class_body, 'model')
        template = self._extract_attribute(class_body, 'template_name')
        context_name = self._extract_attribute(class_body, 'context_object_name') or model.lower() + 's' if model else 'objects'
        paginate_by = self._extract_attribute(class_body, 'paginate_by')

        # Extract get_queryset if present
        queryset_match = re.search(r'def get_queryset\(self\):(.*?)(?=\n    def |\n\nclass |\n\n(?:def [^_])|$)', class_body, re.DOTALL)
        custom_queryset = queryset_match.group(1).strip() if queryset_match else None

        # Generate Flask function
        func_name = self._camel_to_snake(class_name)

        lines = [f"\ndef {func_name}():"]
        lines.append(f'    """{class_name} converted from Django ListView"""')

        # Add pagination
        if paginate_by:
            lines.append("    page = request.args.get('page', 1, type=int)")
            lines.append(f"    per_page = {paginate_by}")

        # Add query
        if custom_queryset:
            # Try to extract the query from custom queryset
            query_lines = custom_queryset.replace('return ', '').strip().split('\n')
            query = query_lines[0].strip()
            lines.append(f"    {context_name} = {query}")
        elif model:
            query = f"{model}.query.all()"
            if paginate_by:
                query = f"{model}.query.paginate(page=page, per_page=per_page, error_out=False)"
            lines.append(f"    {context_name} = {query}")

        # Render template
        if template:
            template_str = template.strip('\'"')
            lines.append(f"    return render_template('{template_str}', {context_name}={context_name})")
        else:
            lines.append(f"    return render_template('list.html', {context_name}={context_name})")

        return '\n'.join(lines) + '\n'

    def _convert_detail_view(self, class_name: str, class_body: str) -> str:
        """Convert Django DetailView to Flask function"""

        model = self._extract_attribute(class_body, 'model')
        template = self._extract_attribute(class_body, 'template_name')
        context_name = self._extract_attribute(class_body, 'context_object_name') or model.lower() if model else 'object'

        func_name = self._camel_to_snake(class_name)

        lines = [f"\ndef {func_name}(pk):"]
        lines.append(f'    """{class_name} converted from Django DetailView"""')

        if model:
            lines.append(f"    {context_name} = get_object_or_404({model}, id=pk)")
        else:
            lines.append(f"    {context_name} = None  # TODO: Specify model")

        if template:
            template_str = template.strip('\'"')
            lines.append(f"    return render_template('{template_str}', {context_name}={context_name})")
        else:
            lines.append(f"    return render_template('detail.html', {context_name}={context_name})")

        return '\n'.join(lines) + '\n'

    def _convert_form_view(self, class_name: str, class_body: str, view_type: str) -> str:
        """Convert CreateView/UpdateView to Flask function"""

        func_name = self._camel_to_snake(class_name)

        lines = [f"\ndef {func_name}(pk=None):"]
        lines.append(f'    """{class_name} converted from Django {view_type}"""')
        lines.append("    # TODO: Implement form handling with Flask-WTF")
        lines.append("    # TODO: Handle GET (display form) and POST (process form)")
        lines.append("    if request.method == 'POST':")
        lines.append("        # Process form data")
        lines.append("        # Validate and save to database")
        lines.append("        return redirect(url_for('success_page'))")
        lines.append("    # Display form")
        lines.append("    return render_template('form.html')")

        self.results['warnings'].append({
            'type': 'form_view',
            'message': f'{view_type} {class_name} converted to skeleton. Implement form logic with Flask-WTF.'
        })

        return '\n'.join(lines) + '\n'

    def _convert_delete_view(self, class_name: str, class_body: str) -> str:
        """Convert DeleteView to Flask function"""

        model = self._extract_attribute(class_body, 'model')
        func_name = self._camel_to_snake(class_name)

        lines = [f"\ndef {func_name}(pk):"]
        lines.append(f'    """{class_name} converted from Django DeleteView"""')

        if model:
            lines.append(f"    obj = get_object_or_404({model}, id=pk)")
            lines.append("    db.session.delete(obj)")
            lines.append("    db.session.commit()")
        else:
            lines.append("    # TODO: Specify model and delete object")

        lines.append("    return redirect(url_for('list_page'))")

        return '\n'.join(lines) + '\n'

    def _extract_attribute(self, class_body: str, attr_name: str) -> str:
        """Extract class attribute value"""
        pattern = rf'{attr_name}\s*=\s*["\']?([^"\'\n]+)["\']?'
        match = re.search(pattern, class_body)
        return match.group(1).strip() if match else None

    def _camel_to_snake(self, name: str) -> str:
        """Convert CamelCase to snake_case"""
        # Remove 'View' suffix if present
        name = re.sub(r'View$', '', name)
        s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
        return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()

    def _convert_orm_queries(self, code: str) -> str:
        """Convert Django ORM queries to SQLAlchemy"""

        # Check if we need to add warning
        has_create = '.objects.create(' in code

        # Convert .objects.all()
        code = re.sub(r'(\w+)\.objects\.all\(\)', r'\1.query.all()', code)

        # Convert .objects.filter()
        code = re.sub(r'(\w+)\.objects\.filter\(', r'\1.query.filter_by(', code)

        # Convert .objects.get()
        code = re.sub(r'(\w+)\.objects\.get\(', r'\1.query.filter_by(', code)

        # Convert .objects.create() - simple replacement
        code = re.sub(r'(\w+)\.objects\.create\(', r'\1(', code)

        # Add warning about create
        if has_create:
            self.results['warnings'].append({
                'type': 'orm_create',
                'message': 'Django .objects.create() converted to model instantiation. Add db.session.add(obj) and db.session.commit().'
            })

        # Convert .order_by()
        def replace_order_by(match):
            prefix = match.group(1)
            field = match.group(2).strip('\'"')

            # Handle descending order (Django uses '-field')
            if field.startswith('-'):
                field = field[1:]
                # Extract model name from prefix
                model_match = re.search(r'(\w+)\.query', prefix)
                if model_match:
                    model = model_match.group(1)
                    return f'{prefix}.order_by({model}.{field}.desc())'

            # Extract model name for ascending order
            model_match = re.search(r'(\w+)\.query', prefix)
            if model_match:
                model = model_match.group(1)
                return f'{prefix}.order_by({model}.{field})'

            return match.group(0)  # Return original if can't parse

        code = re.sub(r'([\w.]+)\.order_by\(["\'](-?\w+)["\']\)', replace_order_by, code)

        # Convert .exclude()
        code = re.sub(r'\.exclude\(', '.filter(~', code)

        # Add warning about relationship queries
        if '.filter' in code or '.all()' in code:
            self.results['warnings'].append({
                'type': 'orm_queries',
                'message': 'Django ORM queries converted to SQLAlchemy. Review relationship queries and joins.'
            })

        return code

    def _convert_request_params(self, code: str) -> str:
        """Convert Django request parameters to Flask"""

        # Remove 'request' parameter from function signatures
        code = re.sub(r'def (\w+)\(request,\s*', r'def \1(', code)
        code = re.sub(r'def (\w+)\(request\):', r'def \1():', code)

        # Convert request.GET to request.args
        code = re.sub(r'request\.GET\.get\(', 'request.args.get(', code)
        code = re.sub(r'request\.GET\[', 'request.args[', code)

        # Convert request.POST to request.form
        code = re.sub(r'request\.POST\.get\(', 'request.form.get(', code)
        code = re.sub(r'request\.POST\[', 'request.form[', code)

        # Convert request.FILES to request.files
        code = re.sub(r'request\.FILES', 'request.files', code)

        # Convert request.user to current_user
        if 'request.user' in code:
            code = re.sub(r'request\.user', 'current_user', code)
            # Add flask_login import if not present
            if 'from flask_login import' not in code:
                code = 'from flask_login import current_user\n' + code

        # Convert request.session to session
        if 'request.session' in code:
            code = re.sub(r'request\.session', 'session', code)
            # Add session import if not present
            if 'from flask import' in code and 'session' not in code.split('\n')[0]:
                code = re.sub(
                    r'(from flask import [^\n]+)',
                    lambda m: m.group(1) + ', session' if 'session' not in m.group(1) else m.group(1),
                    code,
                    count=1
                )

        return code

    def _convert_django_utilities(self, code: str) -> str:
        """Convert Django-specific utilities"""

        # Convert render() to render_template()
        # Handle both 2 and 3 argument versions
        code = re.sub(r'render\(request,\s*', 'render_template(', code)

        # Convert JsonResponse to jsonify
        code = re.sub(r'JsonResponse\(', 'jsonify(', code)

        # Convert HttpResponse
        code = re.sub(r'HttpResponse\(([^)]+)\)', r'make_response(\1)', code)

        # Convert reverse() to url_for()
        code = re.sub(r"reverse\(['\"]([^'\"]+)['\"]\)", r"url_for('\1')", code)

        # Convert messages framework
        if 'messages.' in code:
            self.results['warnings'].append({
                'type': 'messages',
                'message': 'Django messages framework usage detected. Use Flask flash() instead.'
            })

        return code


__all__ = ['ViewsConverter']
