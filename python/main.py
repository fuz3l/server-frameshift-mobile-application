#!/usr/bin/env python3
"""
FrameShift Python Conversion Engine
Main entry point for Django-to-Flask conversion
"""

import argparse
import os
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from python.analyzers.django_analyzer import DjangoAnalyzer
from python.analyzers.framework_detector import FrameworkDetector
from python.converters.ast_models_converter import HybridModelsConverter
from python.converters.ast_routes_converter import ASTRoutesConverter
from python.converters.static_copier import StaticCopier
from python.converters.templates_converter import TemplatesConverter
from python.converters.urls_converter import URLsConverter
from python.generators.smart_flask_generator import SmartFlaskGenerator
from python.report_generators.summary_reporter import SummaryReporter
from python.services.ai_enhancer import AIEnhancer
from python.services.gemini_verifier import GeminiVerifier
from python.utils.logger import logger
from python.utils.progress_emitter import ProgressEmitter


def emit_progress(job_id, step, progress, message):
    """Emit progress update to Node.js."""
    ProgressEmitter.emit(job_id, step, progress, message)


def normalize_conversion_mode(raw_mode):
    mode = (raw_mode or 'default').strip().lower()
    return mode if mode in ['default', 'custom', 'codet5'] else 'default'


def resolve_ai_provider_config(args, conversion_mode):
    if conversion_mode == 'custom':
        return {
            'provider': os.getenv('CUSTOM_API_PROVIDER'),
            'api_key': os.getenv('CUSTOM_API_KEY'),
            'endpoint': os.getenv('CUSTOM_API_ENDPOINT') or None,
            'model': os.getenv('CUSTOM_API_MODEL') or None
        }

    if conversion_mode == 'codet5':
        return {
            'provider': 'codet5',
            'api_key': 'local',
            'endpoint': None,
            'model': 'Salesforce/codet5-small'
        }

    return {
        'provider': 'gemini',
        'api_key': args.gemini_api_key,
        'endpoint': None,
        'model': None
    }


def main():
    """Main conversion function."""
    parser = argparse.ArgumentParser(description='Convert Django project to Flask')
    parser.add_argument('--job-id', required=True, help='Conversion job ID')
    parser.add_argument('--project-path', required=True, help='Path to Django project')
    parser.add_argument('--output-path', required=True, help='Output path for Flask project')
    parser.add_argument('--gemini-api-key', help='Google Gemini API key for verification')
    parser.add_argument('--use-ai', default='true', help='Use AI enhancement (true/false)')
    parser.add_argument('--conversion-mode', default='default', help='Conversion mode: default or custom')
    args = parser.parse_args()

    use_ai = args.use_ai.lower() == 'true'
    conversion_mode = normalize_conversion_mode(args.conversion_mode)

    try:
        logger.info(f"Starting conversion for job {args.job_id}")
        logger.info(f"Django project: {args.project_path}")
        logger.info(f"Output path: {args.output_path}")
        logger.info(f"AI Enhancement: {'Enabled' if use_ai else 'Disabled'}")
        logger.info(f"Conversion mode: {conversion_mode}")

        emit_progress(args.job_id, 'detecting_framework', 5, 'Detecting project framework')
        detector = FrameworkDetector(args.project_path)
        framework_result = detector.detect()

        if not framework_result['is_supported']:
            error_msg = f"Unsupported framework: {framework_result['framework']}. Only Django projects are currently supported."
            logger.error(error_msg)
            raise ValueError(error_msg)

        emit_progress(args.job_id, 'analyzing', 10, 'Analyzing Django project structure')
        analyzer = DjangoAnalyzer(args.project_path)
        analysis_result = analyzer.analyze()
        analysis_result['framework_detection'] = framework_result

        emit_progress(args.job_id, 'converting_models', 30, 'Converting Django models to SQLAlchemy')
        hybrid_models_converter = HybridModelsConverter(args.project_path, args.output_path)
        models_result = hybrid_models_converter.convert()

        emit_progress(args.job_id, 'converting_views', 50, 'Converting Django views to Flask routes')
        ast_routes_converter = ASTRoutesConverter(args.project_path, args.output_path)
        views_result = ast_routes_converter.convert()

        emit_progress(args.job_id, 'converting_urls', 65, 'Converting URL patterns to Flask routes')
        urls_converter = URLsConverter(args.project_path, args.output_path)
        urls_result = urls_converter.convert()

        project_path = Path(args.project_path)
        subdirs = [d for d in os.listdir(project_path) if os.path.isdir(os.path.join(project_path, d))]
        project_name = subdirs[0] if subdirs else project_path.name
        flask_project_path = Path(args.output_path) / project_name

        emit_progress(args.job_id, 'converting_templates', 80, 'Converting Django templates to Jinja2')
        templates_converter = TemplatesConverter(args.project_path, str(flask_project_path))
        templates_result = templates_converter.convert()

        emit_progress(args.job_id, 'copying_static', 82, 'Copying static files')
        static_copier = StaticCopier(args.project_path, str(flask_project_path))
        static_result = static_copier.copy()
        logger.info(f"Static files copied: {static_result.get('total_static_files', 0)}")

        emit_progress(args.job_id, 'generating_skeleton', 85, 'Generating runnable Flask application')
        flask_generator = SmartFlaskGenerator(str(flask_project_path), project_name)
        flask_result = flask_generator.generate_all()
        logger.info(f"Generated Flask app files: {len(flask_result.get('files_generated', []))}")

        ai_config = resolve_ai_provider_config(args, conversion_mode)
        if use_ai and ai_config['api_key']:
            emit_progress(args.job_id, 'ai_enhancement', 87, 'AI enhancing conversion output')
            logger.info(f"Starting AI enhancement with provider: {ai_config['provider']}")

            ai_enhancer = AIEnhancer(
                ai_config['api_key'],
                provider=ai_config['provider'],
                model=ai_config['model'],
                endpoint=ai_config['endpoint']
            )
            ai_enhancements = ai_enhancer.enhance_conversion(
                project_path=flask_project_path,
                models_result=models_result,
                views_result=views_result
            )

            ProgressEmitter.emit_custom(args.job_id, 'ai_enhancements_result', ai_enhancements.get('applied', []))
            logger.info(f"AI enhancements emitted: {len(ai_enhancements.get('applied', []))}")
        else:
            logger.info('AI enhancement skipped')

        emit_progress(args.job_id, 'verifying', 90, 'Verifying conversion with AI')
        should_verify_with_ai = use_ai and bool(args.gemini_api_key)
        gemini_verifier = GeminiVerifier(args.gemini_api_key) if should_verify_with_ai else None
        verification_result = {
            'enabled': bool(gemini_verifier and gemini_verifier.enabled),
            'models_verification': {'enabled': False},
            'views_verification': {'enabled': False},
            'ai_summary': {}
        }

        if gemini_verifier and gemini_verifier.enabled:
            ai_summary = gemini_verifier.generate_summary({
                'models': models_result,
                'views': views_result,
                'urls': urls_result,
                'templates': templates_result
            })
            verification_result['ai_summary'] = ai_summary

        emit_progress(args.job_id, 'generating_report', 95, 'Generating conversion report')
        reporter = SummaryReporter()
        report = reporter.generate({
            'analysis': analysis_result,
            'models': models_result,
            'views': views_result,
            'urls': urls_result,
            'templates': templates_result,
            'verification': verification_result
        })

        emit_progress(args.job_id, 'completed', 100, 'Conversion completed successfully')
        ProgressEmitter.emit_result({
            'success': True,
            'report': report,
            'output_path': args.output_path
        })

        logger.info(f"Conversion completed successfully for job {args.job_id}")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Conversion failed: {str(e)}", exc_info=True)
        ProgressEmitter.emit_error(args.job_id, str(e))
        sys.exit(1)


if __name__ == '__main__':
    main()
