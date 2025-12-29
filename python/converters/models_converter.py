import json
import re
from pathlib import Path
from typing import Dict
from ..utils.file_handler import FileHandler
from ..utils.logger import logger


class ModelsConverter:
    """Convert Django models to SQLAlchemy models using AST transformation"""

    def __init__(self, django_path: str, output_path: str):
        self.django_path = Path(django_path)
        self.output_path = Path(output_path)
        self.rules = self._load_rules()
        self.results = {
            'converted_files': [],
            'total_models': 0,
            'total_fields': 0,
            'issues': [],
            'warnings': []
        }
        self.foreign_keys = []  # Track ForeignKey fields for relationship generation

    def _load_rules(self) -> Dict:
        """Load conversion rules from JSON"""
        rules_path = Path(__file__).parent.parent / 'rules' / 'models_rules.json'
        with open(rules_path, 'r') as f:
            return json.load(f)

    def convert(self) -> Dict:
        """
        Convert all Django models to SQLAlchemy

        Returns:
            Dictionary with conversion results
        """
        logger.info("Starting models conversion")

        # Find all models.py files
        model_files = FileHandler.find_files(str(self.django_path), 'models.py')
        model_files = [f for f in model_files if '__pycache__' not in str(f)]

        for model_file in model_files:
            try:
                result = self._convert_file(model_file)
                self.results['converted_files'].append(result)
                self.results['total_models'] += result.get('models_count', 0)

                # Add per-file conversion detail for frontend display
                self.results['issues'].append({
                    'file': str(model_file.relative_to(self.django_path)),
                    'filename': model_file.name,
                    'status': 'converted',
                    'confidence': 95,  # High confidence for successful conversion
                    'message': f'Successfully converted {result.get("models_count", 0)} model(s)',
                    'description': 'Django models converted to Flask-SQLAlchemy',
                    'category': 'models'
                })
            except Exception as e:
                logger.error(f"Failed to convert {model_file}: {e}", exc_info=True)
                self.results['issues'].append({
                    'file': str(model_file.relative_to(self.django_path)),
                    'filename': model_file.name,
                    'status': 'failed',
                    'confidence': 0,
                    'message': f'Conversion failed: {str(e)}',
                    'description': str(e),
                    'category': 'models',
                    'error': str(e)
                })

        logger.info(f"Models conversion complete. Converted {self.results['total_models']} models")
        return self.results

    def _convert_file(self, file_path: Path) -> Dict:
        """Convert a single Django models file"""
        logger.info(f"Converting models file: {file_path}")

        source_code = FileHandler.read_file(str(file_path))

        # Convert the code
        converted_code = self._convert_models_code(source_code)

        # Calculate output path
        relative_path = file_path.relative_to(self.django_path)
        output_file = self.output_path / relative_path

        # Write converted code
        FileHandler.write_file(str(output_file), converted_code)

        return {
            'file': str(file_path),
            'output': str(output_file),
            'success': True,
            'models_count': converted_code.count('class ') - converted_code.count('class Meta')
        }

    def _convert_models_code(self, source_code: str) -> str:
        """Convert Django models to Flask-SQLAlchemy using regex patterns"""

        converted = source_code
        self.foreign_keys = []  # Reset for each file

        # Step 1: Replace imports
        converted = self._convert_imports(converted)

        # Step 2: Replace model inheritance
        converted = re.sub(r'\(models\.Model\)', '(db.Model)', converted)

        # Step 3: Convert each field type
        converted = self._convert_all_fields(converted)

        # Step 4: Remove Django-specific decorators and imports
        converted = self._remove_django_specifics(converted)

        # Step 5: Convert Meta class
        converted = self._convert_meta_class(converted)

        # Step 6: Add header comment
        header = (
            "# Initialize db instance in your Flask app:\n"
            "# db.init_app(app)\n\n"
        )
        converted = header + converted

        return converted

    def _convert_imports(self, code: str) -> str:
        """Convert Django imports to Flask-SQLAlchemy"""

        # Replace Django model imports
        code = re.sub(
            r'from django\.db import models\s*\n',
            'from flask_sqlalchemy import SQLAlchemy\n\ndb = SQLAlchemy()\n',
            code
        )

        # Remove other Django imports that won't work in Flask
        django_imports = [
            r'from django\.contrib\.auth\.models import .*\n',
            r'from django\.utils import .*\n',
            r'from django\.core import .*\n',
            r'import django\..*\n'
        ]

        for pattern in django_imports:
            # Keep track of removed imports as warnings
            matches = re.findall(pattern, code)
            for match in matches:
                self.results['warnings'].append({
                    'type': 'import_removed',
                    'message': f'Django import removed: {match.strip()}. May need manual replacement.'
                })
            code = re.sub(pattern, '', code)

        return code

    def _convert_all_fields(self, code: str) -> str:
        """Convert all Django field types to SQLAlchemy"""

        # Priority order: ForeignKey first (most complex), then special fields, then basic fields
        field_order = [
            'ForeignKey',
            'OneToOneField',
            'ManyToManyField',
            'DateTimeField',
            'CharField',
            'SlugField',
            'EmailField',
            'URLField',
            'TextField',
            'IntegerField',
            'BigIntegerField',
            'SmallIntegerField',
            'PositiveIntegerField',
            'FloatField',
            'DecimalField',
            'BooleanField',
            'DateField',
            'TimeField',
            'UUIDField',
            'JSONField',
            'BinaryField'
        ]

        for field_name in field_order:
            if field_name in self.rules['field_mappings']:
                code = self._convert_field_type(code, field_name)

        return code

    def _convert_field_type(self, code: str, field_name: str) -> str:
        """Convert a specific Django field type to SQLAlchemy"""

        pattern = rf'(\w+)\s*=\s*models\.{field_name}\((.*?)\)(?:\s*\n|\s*$)'

        def replace_field(match):
            field_var_name = match.group(1)
            params_str = match.group(2)

            # Parse parameters
            params = self._parse_field_params(params_str)

            # Convert based on field type
            if field_name == 'ForeignKey':
                return self._convert_foreign_key(field_var_name, params)
            elif field_name == 'OneToOneField':
                return self._convert_one_to_one(field_var_name, params)
            elif field_name == 'ManyToManyField':
                return self._convert_many_to_many(field_var_name, params)
            elif field_name == 'DateTimeField':
                return self._convert_datetime_field(field_var_name, params)
            elif field_name in ['CharField', 'SlugField']:
                return self._convert_char_field(field_var_name, params, field_name)
            elif field_name == 'EmailField':
                return self._convert_email_field(field_var_name, params)
            elif field_name == 'DecimalField':
                return self._convert_decimal_field(field_var_name, params)
            else:
                return self._convert_simple_field(field_var_name, params, field_name)

        # Use multiline flag to match across lines if needed
        code = re.sub(pattern, replace_field, code, flags=re.MULTILINE | re.DOTALL)

        return code

    def _parse_field_params(self, params_str: str) -> Dict:
        """Parse Django field parameters into a dictionary"""
        params = {}

        if not params_str.strip():
            return params

        # Simple parameter parsing (handles most common cases)
        # For complex cases, this might need enhancement
        param_pattern = r'(\w+)\s*=\s*([^,]+)'
        matches = re.findall(param_pattern, params_str)

        for key, value in matches:
            params[key.strip()] = value.strip()

        # Handle positional arguments (first arg is usually the related model for ForeignKey)
        if '=' not in params_str.split(',')[0] if ',' in params_str else params_str:
            first_arg = params_str.split(',')[0].strip()
            if first_arg and first_arg[0].isupper():  # Likely a model name
                params['_positional_0'] = first_arg

        return params

    def _convert_foreign_key(self, field_name: str, params: Dict) -> str:
        """Convert Django ForeignKey to SQLAlchemy relationship"""

        # Get related model
        related_model = params.get('_positional_0', params.get('to', 'RelatedModel'))
        related_name = params.get('related_name', '').strip('\'"')

        # Remove 'on_delete' as it's not used the same way in SQLAlchemy
        if 'on_delete' in params:
            self.results['warnings'].append({
                'type': 'on_delete',
                'message': f'on_delete parameter removed from {field_name}. Configure cascade in relationship() or use SQLAlchemy events.'
            })

        # Build SQLAlchemy column and relationship
        nullable = self._get_nullable(params)

        # Generate lowercase table name from model name
        table_name = self._to_snake_case(related_model)

        # Create foreign key column
        fk_column_name = f"{field_name}_id"
        fk_column = f"{fk_column_name} = db.Column(db.Integer, db.ForeignKey('{table_name}.id'){nullable})"

        # Create relationship
        backref = f"'{related_name}'" if related_name else f"'{field_name}_set'"
        relationship = f"{field_name} = db.relationship('{related_model}', backref={backref})"

        # Store for later addition
        self.foreign_keys.append((fk_column, relationship))

        return f"{fk_column}\n    {relationship}\n"

    def _convert_one_to_one(self, field_name: str, params: Dict) -> str:
        """Convert Django OneToOneField to SQLAlchemy relationship"""

        related_model = params.get('_positional_0', params.get('to', 'RelatedModel'))
        related_name = params.get('related_name', '').strip('\'"')
        nullable = self._get_nullable(params)

        table_name = self._to_snake_case(related_model)

        fk_column_name = f"{field_name}_id"
        fk_column = f"{fk_column_name} = db.Column(db.Integer, db.ForeignKey('{table_name}.id'), unique=True{nullable})"

        backref = f"'{related_name}'" if related_name else f"'{field_name}'"
        relationship = f"{field_name} = db.relationship('{related_model}', backref=db.backref({backref}, uselist=False))"

        self.results['warnings'].append({
            'type': 'one_to_one',
            'message': f'OneToOneField {field_name} converted. Review relationship configuration.'
        })

        return f"{fk_column}\n    {relationship}\n"

    def _convert_many_to_many(self, field_name: str, params: Dict) -> str:
        """Convert Django ManyToManyField"""

        related_model = params.get('_positional_0', params.get('to', 'RelatedModel'))

        self.results['warnings'].append({
            'type': 'many_to_many',
            'message': f'ManyToManyField {field_name} requires manual association table creation.'
        })

        comment = (
            f"# {field_name} = ManyToMany({related_model})\n"
            f"    # TODO: Create association table and use db.relationship() with secondary parameter\n"
        )

        return comment

    def _convert_datetime_field(self, field_name: str, params: Dict) -> str:
        """Convert DateTimeField with auto_now/auto_now_add support"""

        column_args = ["db.DateTime"]

        # Handle auto_now_add (set on creation)
        if params.get('auto_now_add') == 'True':
            column_args.append("default=db.func.now()")

        # Handle auto_now (update on every save)
        if params.get('auto_now') == 'True':
            column_args.append("onupdate=db.func.now()")
            if 'default' not in str(column_args):
                column_args.append("default=db.func.now()")

        # Handle nullable
        nullable = self._get_nullable(params)
        if nullable:
            column_args.append(nullable.strip(', '))

        # Handle default (if not auto_now)
        if 'default' in params and 'auto_now' not in params:
            default_val = params['default']
            column_args.append(f"default={default_val}")

        column_def = f"db.Column({', '.join(column_args)})"
        return f"{field_name} = {column_def}\n"

    def _convert_char_field(self, field_name: str, params: Dict, field_type: str) -> str:
        """Convert CharField or SlugField"""

        max_length = params.get('max_length', '255' if field_type == 'CharField' else '50')

        column_args = [f"db.String({max_length})"]

        # Add other parameters
        if params.get('unique') == 'True':
            column_args.append("unique=True")

        if params.get('db_index') == 'True' or field_type == 'SlugField':
            column_args.append("index=True")

        nullable = self._get_nullable(params)
        if nullable:
            column_args.append(nullable.strip(', '))

        if 'default' in params:
            default_val = params['default']
            column_args.append(f"default={default_val}")

        column_def = f"db.Column({', '.join(column_args)})"
        return f"{field_name} = {column_def}\n"

    def _convert_email_field(self, field_name: str, params: Dict) -> str:
        """Convert EmailField to String(254)"""

        column_args = ["db.String(254)"]

        nullable = self._get_nullable(params)
        if nullable:
            column_args.append(nullable.strip(', '))

        column_def = f"db.Column({', '.join(column_args)})"
        return f"{field_name} = {column_def}\n"

    def _convert_decimal_field(self, field_name: str, params: Dict) -> str:
        """Convert DecimalField"""

        max_digits = params.get('max_digits', '10')
        decimal_places = params.get('decimal_places', '2')

        column_args = [f"db.Numeric(precision={max_digits}, scale={decimal_places})"]

        nullable = self._get_nullable(params)
        if nullable:
            column_args.append(nullable.strip(', '))

        column_def = f"db.Column({', '.join(column_args)})"
        return f"{field_name} = {column_def}\n"

    def _convert_simple_field(self, field_name: str, params: Dict, django_field: str) -> str:
        """Convert simple fields (IntegerField, TextField, BooleanField, etc.)"""

        mapping = self.rules['field_mappings'].get(django_field, {})
        flask_type = mapping.get('flask', 'db.Column(db.String(255))')

        # Extract just the column type (e.g., "db.Integer" from "db.Column(db.Integer)")
        column_type_match = re.search(r'db\.Column\((db\.\w+)', flask_type)
        if column_type_match:
            column_type = column_type_match.group(1)
        else:
            column_type = "db.String(255)"

        column_args = [column_type]

        # Add parameters
        if params.get('unique') == 'True':
            column_args.append("unique=True")

        if params.get('primary_key') == 'True':
            column_args.append("primary_key=True")

        if params.get('db_index') == 'True':
            column_args.append("index=True")

        nullable = self._get_nullable(params)
        if nullable:
            column_args.append(nullable.strip(', '))

        # Handle default for BooleanField
        if django_field == 'BooleanField' and 'default' not in params:
            column_args.append("default=False")
        elif 'default' in params:
            default_val = params['default']
            column_args.append(f"default={default_val}")

        column_def = f"db.Column({', '.join(column_args)})"
        return f"{field_name} = {column_def}\n"

    def _get_nullable(self, params: Dict) -> str:
        """Determine nullable parameter from Django null/blank"""

        null_value = params.get('null', 'False')

        if null_value == 'True':
            return ', nullable=True'
        elif null_value == 'False':
            return ', nullable=False'

        return ''

    def _to_snake_case(self, name: str) -> str:
        """Convert CamelCase to snake_case"""
        s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
        return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()

    def _remove_django_specifics(self, code: str) -> str:
        """Remove Django-specific decorators and patterns"""

        # Remove blank=True/False (it's a form validation thing, not database)
        code = re.sub(r',?\s*blank\s*=\s*(True|False)', '', code)

        # Note: We don't remove null as it maps to nullable in SQLAlchemy

        return code

    def _convert_meta_class(self, code: str) -> str:
        """Convert Django Meta class to SQLAlchemy __tablename__ and __table_args__"""

        # Find Meta classes
        meta_pattern = r'class Meta:\s*\n((?:\s{4,}.*\n)*)'

        def replace_meta(match):
            meta_body = match.group(1)

            result = []

            # Extract db_table
            db_table_match = re.search(r"db_table\s*=\s*['\"](\w+)['\"]", meta_body)
            if db_table_match:
                table_name = db_table_match.group(1)
                result.append(f"__tablename__ = '{table_name}'")

            # Extract ordering (note it as comment)
            ordering_match = re.search(r'ordering\s*=\s*\[(.*?)\]', meta_body)
            if ordering_match:
                ordering = ordering_match.group(1)
                result.append(f"# ordering = [{ordering}]  # Use query().order_by() instead")
                self.results['warnings'].append({
                    'type': 'ordering',
                    'message': 'Meta.ordering converted to comment. Use query().order_by() in Flask-SQLAlchemy.'
                })

            # Extract verbose_name (note as comment)
            verbose_match = re.search(r'verbose_name[_plural]*\s*=\s*[\'"](.+?)[\'"]', meta_body)
            if verbose_match:
                result.append(f"# verbose_name in Meta class is not supported in SQLAlchemy")

            if result:
                # Proper indentation
                indented = '\n    '.join(result)
                return f"{indented}"
            else:
                self.results['warnings'].append({
                    'type': 'meta_class',
                    'message': 'Empty Meta class removed'
                })
                return ""

        code = re.sub(meta_pattern, replace_meta, code, flags=re.MULTILINE)

        return code


__all__ = ['ModelsConverter']
