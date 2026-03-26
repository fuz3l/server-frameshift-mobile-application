# Converted from Django URLs to Flask routes
# This file shows the URL patterns - integrate with views.py

from flask import Blueprint, request, render_template, redirect, url_for, flash, session
from flask_login import login_required, current_user, login_user, logout_user # Include common Flask-Login imports
from app import db # Assuming db is initialized in app.py (e.g., db = SQLAlchemy(app))
# Assuming a models.py file exists at the app root (e.g., app/models.py)
from app.models import ContactMessage


# Create blueprint
bp = Blueprint("main", __name__)

@bp.route('/about/')
def about():
    """
    Renders the about page.
    This is typically a static information page displaying general information
    about the application or organization.
    """
    return render_template('about.html')

@bp.route('/contact/', methods=['GET', 'POST'])
def contact():
    """
    Displays and processes the contact form.

    On GET request, renders the contact form, optionally pre-filling user details
    if they are logged in.
    On POST request, validates submitted form data, saves the message to the database,
    and redirects to another page upon success or re-renders the form with error
    messages if validation fails or a database error occurs.
    """
    if request.method == 'POST':
        name = request.form.get('name')
        email = request.form.get('email')
        message_text = request.form.get('message')

        errors = []
        if not name:
            errors.append('Name is required.')
        if not email:
            errors.append('Email is required.')
        elif '@' not in email or '.' not in email: # Basic email format validation
            errors.append('Invalid email format.')
        if not message_text:
            errors.append('Message is required.')

        if errors:
            for error in errors:
                flash(error, 'danger') # 'danger' is a common category for error messages
            # Re-render the form with existing data to preserve user input and show errors
            return render_template('contact.html', name=name, email=email, message=message_text)
        else:
            try:
                # Save message to database using SQLAlchemy ORM
                new_message = ContactMessage(name=name, email=email, message=message_text)
                db.session.add(new_message)
                db.session.commit()
                flash('Your message has been sent successfully! We will get back to you shortly.', 'success')
                # Redirect to a different page after successful submission, e.g., about page or a dedicated 'thank you' page
                return redirect(url_for('main.about'))
            except Exception as e:
                db.session.rollback() # Rollback the session in case of a database error
                # In a real application, you would also log the exception for debugging
                # from flask import current_app
                # current_app.logger.error(f"Error saving contact message: {e}")
                flash(f'An unexpected error occurred while sending your message. Please try again later. ({e})', 'danger')
                # Re-render the form with existing data and the error message
                return render_template('contact.html', name=name, email=email, message=message_text)
    
    # For GET request, render the contact form.
    # Optionally pre-fill email if current_user is authenticated
    initial_email = current_user.email if current_user.is_authenticated else ''
    return render_template('contact.html', email=initial_email)
