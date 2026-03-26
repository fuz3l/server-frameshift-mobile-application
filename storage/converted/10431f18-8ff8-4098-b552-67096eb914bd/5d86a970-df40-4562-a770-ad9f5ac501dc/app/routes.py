from flask import Blueprint, request, render_template, redirect, url_for, flash, session
from flask_login import login_required, current_user, login_user, logout_user
from app import db
from app.models import ContactMessage # Assuming ContactMessage model is defined in app/models.py

# Create blueprint
bp = Blueprint("main", __name__)

@bp.route('/about/')
def about():
    """
    Renders the about page.
    """
    return render_template('about.html')

@bp.route('/contact/', methods=['GET', 'POST'])
def contact():
    """
    Handles the contact form:
    - GET: Displays the contact form.
    - POST: Processes the form submission, saves the message, and redirects.
    """
    if request.method == 'POST':
        name = request.form.get('name')
        email = request.form.get('email')
        message_content = request.form.get('message')

        if not name or not email or not message_content:
            flash('Please fill in all required fields.', 'danger')
            # Render the template again, passing the data back to repopulate the form
            return render_template('contact.html', name=name, email=email, message=message_content)

        try:
            new_message = ContactMessage(name=name, email=email, message=message_content)
            db.session.add(new_message)
            db.session.commit()
            flash('Your message has been sent successfully! We will get back to you soon.', 'success')
            # Redirect to the GET version of the contact page to clear the form
            return redirect(url_for('main.contact'))
        except Exception as e:
            db.session.rollback() # Rollback the session in case of an error
            flash(f'An error occurred while sending your message: {e}', 'danger')
            # Render the template with existing data even on DB error
            return render_template('contact.html', name=name, email=email, message=message_content)
    
    # For GET requests
    return render_template('contact.html')