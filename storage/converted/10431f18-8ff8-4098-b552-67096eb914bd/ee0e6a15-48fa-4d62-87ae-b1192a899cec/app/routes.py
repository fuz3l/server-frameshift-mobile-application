# Converted from Django URLs to Flask routes
# This file shows the URL patterns - integrate with views.py

from flask import Blueprint, request, render_template, redirect, url_for, flash, session
from flask_login import login_required, current_user, login_user, logout_user
from app import db # Assuming db is initialized in app/__init__.py
from app.models import User, ContactMessage # Assuming models are in app/models.py
from app.forms import ContactForm # Assuming forms are in app/forms.py

# Create blueprint
bp = Blueprint("main", __name__)

@bp.route('/about/')
def about():
    """
    Renders the about page.
    Displays general information, potentially including current user details.
    """
    # Implement about view
    return render_template('about.html', current_user=current_user)

@bp.route('/contact/', methods=['GET', 'POST'])
def contact():
    """
    Handles the contact form submission.
    Displays the contact form on GET requests and processes submissions on POST requests.
    Saves valid contact messages to the database.
    """
    form = ContactForm()
    if request.method == 'POST' and form.validate_on_submit():
        try:
            # Create a new ContactMessage instance
            contact_message = ContactMessage(
                name=form.name.data,
                email=form.email.data,
                subject=form.subject.data,
                message=form.message.data
            )
            # If a user is logged in, link the message to them
            if current_user.is_authenticated:
                contact_message.user_id = current_user.id

            db.session.add(contact_message)
            db.session.commit()
            flash('Your message has been sent successfully!', 'success')
            return redirect(url_for('main.contact')) # Redirect to prevent form resubmission
        except Exception as e:
            db.session.rollback() # Rollback the session in case of an error
            flash(f'There was an error sending your message: {e}', 'danger')
    elif request.method == 'POST':
        # Form validation failed
        for field, errors in form.errors.items():
            for error in errors:
                flash(f"Error in {getattr(form, field).label.text}: {error}", 'danger')
    
    # Render the contact form page for GET requests or if validation fails
    return render_template('contact.html', form=form)