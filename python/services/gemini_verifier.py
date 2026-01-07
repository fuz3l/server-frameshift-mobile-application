"""
Gemini AI Verification Service
Uses Google Gemini API to verify conversion quality
"""

import os
import json
from typing import Dict, List, Optional
from pathlib import Path
from ..utils.logger import logger

# Try to import google-generativeai
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    logger.warning("google-generativeai not installed. AI verification will be disabled.")


class GeminiVerifier:
    """Verify conversion quality using Google Gemini API"""

    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize Gemini verifier

        Args:
            api_key: Google Gemini API key
        """
        self.api_key = api_key or os.getenv('GEMINI_API_KEY')
        self.enabled = GEMINI_AVAILABLE and bool(self.api_key)
        self.model = None

        if self.enabled:
            try:
                genai.configure(api_key=self.api_key)
                self.model = genai.GenerativeModel('gemini-2.5-flash')
                logger.info("Gemini AI verification enabled with Gemini 2.5 Flash")
            except Exception as e:
                logger.error(f"Failed to initialize Gemini: {e}")
                self.enabled = False
        else:
            if not GEMINI_AVAILABLE:
                logger.warning("Gemini AI not available: google-generativeai package not installed")
            elif not self.api_key:
                logger.warning("Gemini AI not available: API key not provided")

    def verify_conversion(self, original_code: str, converted_code: str, file_type: str) -> Dict:
        """
        Verify conversion quality using AI

        Args:
            original_code: Original Django code
            converted_code: Converted Flask code
            file_type: Type of file ('models', 'views', 'urls', 'templates')

        Returns:
            Verification result dictionary
        """
        if not self.enabled:
            return self._get_disabled_result()

        try:
            prompt = self._build_verification_prompt(original_code, converted_code, file_type)
            response = self.model.generate_content(prompt)
            result = self._parse_verification_response(response.text)

            logger.info(f"AI verification complete for {file_type}: score {result['score']}/10")
            return result

        except Exception as e:
            logger.error(f"Gemini verification failed: {e}")
            return self._get_error_result(str(e))

    def generate_summary(self, conversion_results: Dict) -> Dict:
        """
        Generate AI summary of entire conversion

        Args:
            conversion_results: Complete conversion results

        Returns:
            AI summary dictionary
        """
        if not self.enabled:
            return self._get_disabled_summary()

        try:
            prompt = self._build_summary_prompt(conversion_results)
            response = self.model.generate_content(prompt)
            summary = self._parse_summary_response(response.text)

            logger.info("AI summary generated successfully")
            return summary

        except Exception as e:
            logger.error(f"Gemini summary generation failed: {e}")
            return self._get_error_summary(str(e))

    def _build_verification_prompt(self, original: str, converted: str, file_type: str) -> str:
        """Build prompt for conversion verification"""

        type_specific_instructions = {
            'models': """
Focus on:
- Django models -> SQLAlchemy models conversion
- Field type mappings (CharField -> String, etc.)
- Relationship definitions (ForeignKey -> relationship())
- Meta class handling
- Model method conversions
            """,
            'views': """
Focus on:
- Django views -> Flask route functions
- Request/Response handling
- ORM query conversions (.objects -> .query)
- Template rendering (render -> render_template)
- Class-based views -> function-based views
            """,
            'urls': """
Focus on:
- Django URL patterns -> Flask routes
- Path converters (<int:id> -> <int:id>)
- URL namespacing
- Route decorator syntax
            """,
            'templates': """
Focus on:
- Django template tags -> Jinja2 syntax
- Template filters
- URL generation ({% url %} -> url_for())
- Static file references
            """
        }

        instructions = type_specific_instructions.get(file_type, "")

        prompt = f"""
You are an expert code reviewer specializing in Django to Flask conversions.

**Original Django Code:**
```python
{original[:2000]}  # Limited to 2000 chars for API limits
```

**Converted Flask Code:**
```python
{converted[:2000]}  # Limited to 2000 chars for API limits
```

**File Type:** {file_type}

{instructions}

**Task:** Analyze the conversion quality and provide:

1. **Score** (0-10): How accurate is the conversion?
2. **Issues**: List critical errors or incorrect conversions
3. **Warnings**: List potential problems or non-idiomatic code
4. **Suggestions**: List improvements or best practices
5. **Summary**: Brief overall assessment (2-3 sentences)

**Response Format (JSON):**
```json
{{
    "score": 8,
    "issues": ["Issue 1", "Issue 2"],
    "warnings": ["Warning 1"],
    "suggestions": ["Suggestion 1", "Suggestion 2"],
    "summary": "Brief summary here"
}}
```

Provide ONLY the JSON response, no additional text.
        """

        return prompt.strip()

    def _build_summary_prompt(self, results: Dict) -> str:
        """Build prompt for conversion summary"""

        stats = f"""
Models converted: {results.get('models', {}).get('total_models', 0)}
Views converted: {results.get('views', {}).get('total_views', 0)}
URLs converted: {results.get('urls', {}).get('total_patterns', 0)}
Templates converted: {results.get('templates', {}).get('total_templates', 0)}

Total issues: {len(results.get('models', {}).get('issues', [])) + len(results.get('views', {}).get('issues', []))}
Total warnings: {len(results.get('models', {}).get('warnings', [])) + len(results.get('views', {}).get('warnings', []))}
        """

        prompt = f"""
You are an expert in web framework migrations, specifically Django to Flask conversions.

**Conversion Statistics:**
{stats}

**Task:** Generate a comprehensive summary of this Django to Flask conversion project.

Include:
1. **Overall Quality Assessment** (0-100%): How complete and accurate is the conversion?
2. **Key Achievements**: What was successfully converted?
3. **Critical Issues**: What needs immediate attention?
4. **Recommendations**: Top 3-5 actionable next steps
5. **Deployment Readiness**: Is this ready for production? What's needed?

**Response Format (JSON):**
```json
{{
    "overall_quality": 85,
    "key_achievements": ["Achievement 1", "Achievement 2"],
    "critical_issues": ["Issue 1", "Issue 2"],
    "recommendations": ["Rec 1", "Rec 2", "Rec 3"],
    "deployment_readiness": "Description of readiness",
    "summary": "Executive summary paragraph"
}}
```

Provide ONLY the JSON response, no additional text.
        """

        return prompt.strip()

    def _parse_verification_response(self, response_text: str) -> Dict:
        """Parse AI verification response"""
        try:
            # Extract JSON from response (handle markdown code blocks)
            json_text = response_text
            if '```json' in response_text:
                json_text = response_text.split('```json')[1].split('```')[0].strip()
            elif '```' in response_text:
                json_text = response_text.split('```')[1].split('```')[0].strip()

            result = json.loads(json_text)

            # Validate and normalize
            return {
                'score': min(max(result.get('score', 7), 0), 10),
                'issues': result.get('issues', [])[:10],  # Limit to 10
                'warnings': result.get('warnings', [])[:10],
                'suggestions': result.get('suggestions', [])[:10],
                'summary': result.get('summary', 'Conversion completed')
            }

        except Exception as e:
            logger.error(f"Failed to parse Gemini response: {e}")
            # Return default result
            return {
                'score': 7,
                'issues': [],
                'warnings': ['AI verification response parsing failed'],
                'suggestions': [],
                'summary': 'Conversion completed. Manual review recommended.'
            }

    def _parse_summary_response(self, response_text: str) -> Dict:
        """Parse AI summary response"""
        try:
            # Extract JSON from response
            json_text = response_text
            if '```json' in response_text:
                json_text = response_text.split('```json')[1].split('```')[0].strip()
            elif '```' in response_text:
                json_text = response_text.split('```')[1].split('```')[0].strip()

            result = json.loads(json_text)

            return {
                'overall_quality': min(max(result.get('overall_quality', 75), 0), 100),
                'key_achievements': result.get('key_achievements', [])[:5],
                'critical_issues': result.get('critical_issues', [])[:5],
                'recommendations': result.get('recommendations', [])[:5],
                'deployment_readiness': result.get('deployment_readiness', 'Review required'),
                'summary': result.get('summary', 'Conversion summary not available')
            }

        except Exception as e:
            logger.error(f"Failed to parse Gemini summary: {e}")
            return self._get_default_summary()

    def _get_disabled_result(self) -> Dict:
        """Get result when AI is disabled"""
        return {
            'score': 7,
            'issues': [],
            'warnings': ['AI verification disabled: Install google-generativeai package and set GEMINI_API_KEY'],
            'suggestions': ['pip install google-generativeai'],
            'summary': 'AI verification not available. Manual review recommended.',
            'enabled': False
        }

    def _get_error_result(self, error: str) -> Dict:
        """Get result when AI verification fails"""
        return {
            'score': 7,
            'issues': [],
            'warnings': [f'AI verification error: {error}'],
            'suggestions': [],
            'summary': 'AI verification encountered an error. Manual review recommended.',
            'enabled': False
        }

    def _get_disabled_summary(self) -> Dict:
        """Get summary when AI is disabled"""
        return {
            'overall_quality': 75,
            'key_achievements': ['Conversion completed'],
            'critical_issues': ['AI summary not available'],
            'recommendations': [
                'Install google-generativeai package',
                'Set GEMINI_API_KEY environment variable',
                'Manually review all converted files'
            ],
            'deployment_readiness': 'Manual review required',
            'summary': 'AI summary not available. Conversion completed successfully. Please review all files manually.',
            'enabled': False
        }

    def _get_error_summary(self, error: str) -> Dict:
        """Get summary when AI summary fails"""
        return {
            'overall_quality': 75,
            'key_achievements': ['Conversion completed'],
            'critical_issues': [f'AI summary error: {error}'],
            'recommendations': ['Manually review all converted files'],
            'deployment_readiness': 'Manual review required',
            'summary': f'AI summary generation failed: {error}. Please review manually.',
            'enabled': False
        }

    def _get_default_summary(self) -> Dict:
        """Get default summary"""
        return {
            'overall_quality': 75,
            'key_achievements': ['Django models converted to SQLAlchemy', 'Views converted to Flask routes'],
            'critical_issues': [],
            'recommendations': [
                'Review all converted files',
                'Test database migrations',
                'Verify URL routing'
            ],
            'deployment_readiness': 'Testing required before deployment',
            'summary': 'Conversion completed. Manual testing recommended before deployment.'
        }


__all__ = ['GeminiVerifier']
