from flask import Blueprint, request, render_template, redirect, url_for, flash, session
from flask_login import login_required, current_user

# Assuming db is initialized in app.py (e.g., `db = SQLAlchemy(app)`)
from app import db

# --- DUMMY MODELS FOR DEMONSTRATION PURPOSES ---
# In a real Flask application, these models would typically reside
# in a separate file (e.g., app/models.py) and imported from there.
# They are included here to fulfill the "Convert Django ORM to SQLAlchemy" requirement.

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    # password_hash would be used for actual password storage
    password_hash = db.Column(db.String(128))

    def __repr__(self):
        return f'<User {self.username}>'

    # Flask-Login UserMixin properties (simplified for demonstration)
    @property
    def is_authenticated(self):
        return True # For simplicity, assume a User object means authenticated

    @property
    def is_active(self):
        return True

    @property
    def is_anonymous(self):
        return False

    def get_id(self):
        return str(self.id)

class ContactMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sender_name = db.Column(db.String(100), nullable=False)
    sender_email = db.Column(db.String(120), nullable=False)
    message_text = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=db.func.current_timestamp())
    # Example of a foreign key relationship (optional: if message from a logged-in user)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    user = db.relationship('User', backref='contact_messages')

    def __repr__(self):
        return f'<ContactMessage from {self.sender_email}>'

# --- END DUMMY MODELS ---


# Create blueprint
bp = Blueprint("main", __name__)

@bp.route('/about/')
def about():
    """
    Renders the about page.
    Demonstrates rendering a simple template and passing context.
    Also shows basic session usage for a visit counter.
    """
    # Increment a visit counter for the about page in the session
    if 'about_visits' not in session:
        session['about_visits'] = 1
    else:
        session['about_visits'] += 1

    flash(f"You have visited the About page {session['about_visits']} times.", 'info')

    context = {
        'page_title': 'About Us',
        'company_name': 'My Awesome Company',
        'total_about_visits': session.get('about_visits')
    }
    return render_template('about.html', **context)

@bp.route('/contact/', methods=['GET', 'POST'])
@login_required # Example: Only logged-in users can access the contact form
def contact():
    """
    Handles the contact form submission.
    - On GET: Renders the contact form, optionally pre-filling fields.
    - On POST: Processes the form data, saves a new ContactMessage to the database,
               and provides feedback using flash messages.
    Demonstrates: request.method, request.form, request.args, render_template,
                   redirect, url_for, flash, session, Flask-Login,
                   SQLAlchemy ORM (add, commit, rollback), and error handling.
    """
    if request.method == 'POST':
        sender_name = request.form.get('name')
        sender_email = request.form.get('email')
        message_text = request.form.get('message')

        # Basic server-side validation
        if not sender_name or not sender_email or not message_text:
            flash('All fields are required to send a message!', 'danger')
            # Re-render the form with user's input to avoid re-typing
            return render_template('contact.html',
                                   name=sender_name,
                                   email=sender_email,
                                   message=message_text)

        # Use current_user.id if available and authenticated
        user_id = current_user.id if current_user.is_authenticated else None

        try:
            # Create and save the contact message using SQLAlchemy
            new_message = ContactMessage(
                sender_name=sender_name,
                sender_email=sender_email,
                message_text=message_text,
                user_id=user_id # Link to logged-in user if applicable
            )
            db.session.add(new_message)
            db.session.commit()

            flash('Your message has been sent successfully!', 'success')

            # Store last message sender in session (example of session use)
            session['last_contact_sender'] = sender_name

            # Redirect to prevent form resubmission on page refresh
            return redirect(url_for('main.contact'))

        except Exception as e:
            db.session.rollback() # Rollback transaction in case of error
            flash(f'An error occurred while sending your message: {e}', 'danger')
            # Re-render the form with current data so user doesn't lose input
            return render_template('contact.html',
                                   name=sender_name,
                                   email=sender_email,
                                   message=message_text)

    # If GET request, just render the empty form
    # Pre-fill name/email if user is logged in, or from session
    name_prefill = current_user.username if current_user.is_authenticated else session.get('last_contact_sender', '')
    email_prefill = current_user.email if current_user.is_authenticated else ''

    # Demonstrate request.args for query parameters (e.g., /contact/?subject=Inquiry)
    subject_from_query = request.args.get('subject', 'General Inquiry')
    if subject_from_query != 'General Inquiry':
        flash(f"You're on the contact page with subject: '{subject_from_query}'", 'info')

    return render_template('contact.html',
                           name=name_prefill,
                           email=email_prefill,
                           message="",
                           subject=subject_from_query)