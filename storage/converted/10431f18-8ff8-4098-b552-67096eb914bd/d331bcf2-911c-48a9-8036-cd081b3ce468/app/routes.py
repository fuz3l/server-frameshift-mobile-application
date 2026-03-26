# Converted from Django URLs to Flask routes
# This file shows the URL patterns - integrate with views.py

from flask import Blueprint, request, render_template, redirect, url_for, flash, session
from flask_login import login_required, current_user, login_user, logout_user
from app import db
from app.models import ContactMessage # Assuming ContactMessage model exists in app/models.py

# Create blueprint
bp = Blueprint("main", __name__)

@bp.route('/about/')
def about():
    """
    Renders the static about page.
    """
    return render_template('about.html', title='About Us')

@bp.route('/contact/', methods=['GET', 'POST'])
def contact():
    """
    Handles the display and submission of the contact form.

    If a GET request, it renders the contact form.
    If a POST request, it processes the form data, saves the message to the database,
    and redirects or displays an error.
    """
    if request.method == 'POST':
        name = request.form.get('name')
        email = request.form.get('email')
        message = request.form.get('message')

        # Basic server-side validation
        if not name:
            flash('Name is required.', 'danger')
        if not email:
            flash('Email is required.', 'danger')
        if not message:
            flash('Message is required.', 'danger')

        if not name or not email or not message:
            # Re-render the form with user input and error messages
            return render_template(
                'contact.html',
                title='Contact Us',
                name=name,
                email=email,
                message=message
            )

        try:
            # Create a new ContactMessage instance
            new_message = ContactMessage(name=name, email=email, message=message)
            
            # Add to session and commit to database
            db.session.add(new_message)
            db.session.commit()
            
            flash('Your message has been sent successfully! We will get back to you soon.', 'success')
            # Redirect to the GET version of the page to prevent re-submission on refresh
            return redirect(url_for('main.contact'))
        except Exception as e:
            db.session.rollback() # Rollback the session in case of an error
            flash(f'An error occurred while sending your message. Please try again later. Error: {e}', 'danger')
            # Re-render the form with user input and error messages
            return render_template(
                'contact.html',
                title='Contact Us',
                name=name,
                email=email,
                message=message
            )

    # For GET requests, just render the empty form
    return render_template('contact.html', title='Contact Us')
