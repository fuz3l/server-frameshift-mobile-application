"""
AI-Powered Conversion Enhancer using Google Gemini
Fixes critical issues that regex-based converters miss
"""

import os
import re
from pathlib import Path
from typing import Dict, List
from ..utils.logger import logger

try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    logger.warning("google-generativeai not installed. AI features disabled.")


class AIEnhancer:
    """
    Uses Google Gemini to enhance converted Flask code
    Focuses on fixing specific high-impact issues
    """

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.enabled = GEMINI_AVAILABLE and api_key
        self.enhancements_applied = []

        if self.enabled:
            genai.configure(api_key=api_key)
            self.model = genai.GenerativeModel('gemini-2.5-flash')  # Using Gemini 2.5 Flash - optimized for coding
            logger.info("AI Enhancer initialized with Gemini 2.5 Flash")
        else:
            logger.warning("AI Enhancer disabled (missing API key or library)")

    def enhance_conversion(self, project_path: Path, models_result: Dict, views_result: Dict) -> Dict:
        """
        Main enhancement entry point
        Applies AI fixes to converted code
        """
        if not self.enabled:
            return {'enabled': False, 'applied': []}

        logger.info(f"Starting AI enhancement for project: {project_path}")

        # Enhancement 1: Fix AbstractUser models
        self._fix_abstract_user_models(project_path)

        # Enhancement 2: Implement route logic
        self._implement_route_logic(project_path)

        return {
            'enabled': True,
            'applied': self.enhancements_applied
        }

    def _fix_abstract_user_models(self, project_path: Path):
        """
        Fix Django AbstractUser models to Flask-SQLAlchemy + UserMixin
        This is the #1 critical issue
        """
        logger.info("AI Enhancement: Fixing AbstractUser models...")

        # Find all models.py files
        for models_file in project_path.rglob('models.py'):
            try:
                content = models_file.read_text(encoding='utf-8')

                # Check if AbstractUser is used
                if 'AbstractUser' not in content and 'AbstractBaseUser' not in content:
                    continue

                logger.info(f"Found AbstractUser in {models_file}")

                # Use Gemini to fix it
                fixed_content = self._fix_abstract_user_with_ai(content, models_file.name)

                if fixed_content and fixed_content != content:
                    # Backup original
                    backup_file = models_file.with_suffix('.py.backup')
                    backup_file.write_text(content, encoding='utf-8')

                    # Write fixed version
                    models_file.write_text(fixed_content, encoding='utf-8')

                    self.enhancements_applied.append(f"abstract_user:{models_file.name}")
                    logger.info(f"[AI] Fixed AbstractUser in {models_file.name}")

            except Exception as e:
                logger.error(f"Error fixing AbstractUser in {models_file}: {e}")

    def _fix_abstract_user_with_ai(self, content: str, filename: str) -> str:
        """Use Gemini to properly convert AbstractUser to Flask"""

        prompt = f"""You are an expert at converting Django models to Flask-SQLAlchemy.

TASK: Fix this Django model that uses AbstractUser to work with Flask-SQLAlchemy and Flask-Login.

CURRENT CODE (BROKEN):
```python
{content}
```

REQUIREMENTS:
1. Replace `AbstractUser` or `AbstractBaseUser` with `db.Model, UserMixin`
2. Add ALL standard user fields that AbstractUser provides:
   - id (primary key)
   - password (hashed password field, String(255))
   - email (unique, not null, String(254))
   - first_name (String(30))
   - last_name (String(30))
   - is_active (Boolean, default True)
   - is_staff (Boolean, default False)
   - is_superuser (Boolean, default False)
   - date_joined (DateTime, default now)
   - last_login (DateTime, nullable)

3. Remove Django-specific fields:
   - USERNAME_FIELD
   - REQUIRED_FIELDS
   - objects (custom managers like CustomUserManager)

4. Keep any custom fields that were added (like role, gender, etc.)

5. Add proper imports:
   - from flask_login import UserMixin
   - Keep the existing db import

6. Make sure ALL columns use db.Column() syntax

7. Add __tablename__ if not present

IMPORTANT: Return ONLY the fixed Python code. No explanations, no markdown code blocks, just pure Python code.
"""

        try:
            response = self.model.generate_content(prompt)
            fixed_code = response.text.strip()

            # Remove markdown code blocks if present
            fixed_code = re.sub(r'^```python\s*\n?', '', fixed_code)
            fixed_code = re.sub(r'\n?```\s*$', '', fixed_code)

            return fixed_code

        except Exception as e:
            logger.error(f"Gemini API error fixing AbstractUser: {e}")
            return None

    def _implement_route_logic(self, project_path: Path):
        """
        Implement actual logic in routes that currently just have 'pass'
        This is the #2 critical issue
        """
        logger.info("AI Enhancement: Implementing route logic...")

        # Find all routes.py files
        for routes_file in project_path.rglob('routes.py'):
            try:
                content = routes_file.read_text(encoding='utf-8')

                # Check if there are empty routes (just 'pass')
                if 'pass' not in content:
                    continue

                logger.info(f"Found empty routes in {routes_file}")

                # Also find corresponding views.py if it exists
                views_file = routes_file.parent / 'views.py'
                views_content = None
                if views_file.exists():
                    views_content = views_file.read_text(encoding='utf-8')

                # Use Gemini to implement routes
                implemented_content = self._implement_routes_with_ai(
                    content,
                    views_content,
                    routes_file.name
                )

                if implemented_content and implemented_content != content:
                    # Backup original
                    backup_file = routes_file.with_suffix('.py.backup')
                    backup_file.write_text(content, encoding='utf-8')

                    # Write implemented version
                    routes_file.write_text(implemented_content, encoding='utf-8')

                    self.enhancements_applied.append(f"routes:{routes_file.name}")
                    logger.info(f"[AI] Implemented routes in {routes_file.name}")

            except Exception as e:
                logger.error(f"Error implementing routes in {routes_file}: {e}")

    def _implement_routes_with_ai(self, routes_content: str, views_content: str, filename: str) -> str:
        """Use Gemini to implement route logic"""

        views_context = ""
        if views_content:
            views_context = f"""
ORIGINAL DJANGO VIEWS (for reference):
```python
{views_content}
```
"""

        prompt = f"""You are an expert at converting Django views to Flask routes.

TASK: Implement these Flask routes that currently just have 'pass' statements.

CURRENT ROUTES (EMPTY):
```python
{routes_content}
```

{views_context}

REQUIREMENTS:
1. Replace all 'pass' statements with actual Flask route implementations

2. Use proper Flask patterns:
   - request.method for GET/POST handling
   - request.form for form data
   - request.args for query parameters
   - render_template() for rendering
   - redirect(url_for()) for redirects
   - flash() for messages
   - session for session management

3. Convert Django ORM to SQLAlchemy:
   - Model.objects.get(id=x) → Model.query.get(x)
   - Model.objects.filter() → Model.query.filter_by()
   - Model.objects.all() → Model.query.all()
   - model.save() → db.session.add(model); db.session.commit()
   - model.delete() → db.session.delete(model); db.session.commit()

4. Add proper error handling (try/except where needed)

5. Use Flask-Login decorators where appropriate (@login_required)

6. Import necessary Flask modules at the top:
   - from flask import request, render_template, redirect, url_for, flash, session
   - from flask_login import login_required, current_user, login_user, logout_user
   - from app import db (or wherever db comes from)

7. Keep the existing Blueprint structure

8. Add docstrings to functions

IMPORTANT: Return ONLY the fixed Python code. No explanations, no markdown code blocks, just pure Python code.
"""

        try:
            response = self.model.generate_content(prompt)
            implemented_code = response.text.strip()

            # Remove markdown code blocks if present
            implemented_code = re.sub(r'^```python\s*\n?', '', implemented_code)
            implemented_code = re.sub(r'\n?```\s*$', '', implemented_code)

            return implemented_code

        except Exception as e:
            logger.error(f"Gemini API error implementing routes: {e}")
            return None


__all__ = ['AIEnhancer']
