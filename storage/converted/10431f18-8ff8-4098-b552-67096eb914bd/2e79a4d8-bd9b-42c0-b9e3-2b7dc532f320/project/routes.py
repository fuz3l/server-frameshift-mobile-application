from flask import request, render_template, redirect, url_for, flash, session, Blueprint
from flask_login import login_required, current_user, login_user, logout_user

# Assuming db (SQLAlchemy instance) is initialized in app.py or similar
# and models (User, Product) are defined in app/models.py
from app import db
from app.models import User, Product # Assuming these models exist

# Create blueprint
bp = Blueprint("main", __name__)

@bp.route('/admin/')
@login_required
def site():
    """
    Admin site dashboard view.
    Requires the user to be logged in and have administrative privileges.
    Displays recent users and products.
    """
    # Check if the current user has administrative privileges
    # This assumes your User model has an 'is_admin' attribute or similar logic.
    if not hasattr(current_user, 'is_admin') or not current_user.is_admin:
        flash('You do not have permission to access the admin site.', 'warning')
        return redirect(url_for('main.index')) # Redirect to a non-admin page, e.g., homepage

    try:
        # Fetch data for the admin dashboard
        # Equivalent to Django ORM: User.objects.all().order_by('-date_joined')[:10]
        recent_users = User.query.order_by(User.date_joined.desc()).limit(10).all()

        # Equivalent to Django ORM: Product.objects.all().order_by('-created_at')[:10]
        recent_products = Product.query.order_by(Product.created_at.desc()).limit(10).all()

        # Render the admin dashboard template, passing the fetched data
        return render_template('admin/dashboard.html',
                               recent_users=recent_users,
                               recent_products=recent_products)

    except Exception as e:
        # In case of a database error or other issues, rollback the session
        # and flash an error message.
        db.session.rollback()
        flash(f'An error occurred while loading the admin dashboard: {e}', 'danger')
        # Redirect to a safe page or render an error page
        return redirect(url_for('main.index'))