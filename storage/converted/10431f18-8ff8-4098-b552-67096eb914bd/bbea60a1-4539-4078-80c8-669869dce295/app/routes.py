# Converted from Django URLs to Flask routes
# This file shows the URL patterns - integrate with views.py

from flask import Blueprint, request, render_template, redirect, url_for, flash, session
from flask_login import login_required, current_user, login_user, logout_user
from app import db # Assuming db (SQLAlchemy instance) is initialized in app.py

# Create blueprint
bp = Blueprint("main", __name__)

# --- Dummy Model for Contact Form (assuming it's defined in models.py or similar) ---
# This class is included here for context to make the contact route runnable and
# demonstrate SQLAlchemy ORM usage. In a real application, you would import this
# from your models.py file, e.g., from .models import ContactMessage
class ContactMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100), nullable=False)
    message = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=db.func.now())

    def __repr__(self):
        return f'<ContactMessage {self.name} - {self.email}>'
# --- End Dummy Model ---


@bp.route('/about/')
def about():
    """
    Renders the about page.
    """
    return render_template('about.html')

@bp.route('/contact/', methods=['GET', 'POST'])
def contact():
    """
    Handles the contact form.
    Displays the form on GET request.
    Processes form submission on POST request, saves message to database,
    and redirects with a flash message.
    """
    if request.method == 'POST':
        name = request.form.get('name')
        email = request.form.get('email')
        message = request.form.get('message')

        if not name or not email or not message:
            flash('Please fill in all fields.', 'danger')
            # Re-render the form with user's input
            return render_template('contact.html', name=name, email=email, message=message)

        try:
            # Create a new contact message instance
            new_message = ContactMessage(name=name, email=email, message=message)
            db.session.add(new_message)
            db.session.commit()
            flash('Your message has been sent successfully!', 'success')
            return redirect(url_for('main.contact')) # Redirect to GET endpoint
        except Exception as e:
            db.session.rollback() # Rollback in case of error
            flash(f'An error occurred while sending your message. Please try again. Error: {e}', 'danger')
            # Re-render the form with user's input on error
            return render_template('contact.html', name=name, email=email, message=message)
    
    # For GET requests, just render the empty form
    return render_template('contact.html')