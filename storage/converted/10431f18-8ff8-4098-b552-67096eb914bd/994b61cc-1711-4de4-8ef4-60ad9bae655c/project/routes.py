from flask import Blueprint, request, render_template, redirect, url_for, flash, session
from flask_login import login_required, current_user, login_user, logout_user
from app import db # Assuming db is initialized in app/__init__.py
from app.models import User, Post # Assuming User and Post models are in app/models.py
# (Note: In a real application, you would ensure these models and 'db' are correctly defined and imported.)

# Create blueprint
bp = Blueprint("main", __name__)

@bp.route('/admin/')
@login_required
def site():
    """
    Admin dashboard view.
    Displays a list of recent posts and general administrative information.
    Supports basic pagination and search for posts.
    Requires the user to be logged in and have administrative privileges.
    """
    # Check if the current user has admin privileges
    # Assuming the User model has an 'is_admin' attribute
    if not hasattr(current_user, 'is_admin') or not current_user.is_admin:
        flash("You do not have administrative access.", "danger")
        return redirect(url_for('main.index')) # Redirect to a suitable non-admin page, e.g., homepage

    page = request.args.get('page', 1, type=int)
    search_query = request.args.get('q', '', type=str)
    per_page = 10 # Number of items per page

    try:
        # Query for posts, applying search filter and pagination
        posts_query = Post.query.order_by(Post.date_posted.desc())

        if search_query:
            posts_query = posts_query.filter(
                (Post.title.contains(search_query)) |
                (Post.content.contains(search_query))
            )

        posts = posts_query.paginate(page=page, per_page=per_page, error_out=False)

        # Fetch other administrative data
        total_users = User.query.count()
        recent_users = User.query.order_by(User.id.desc()).limit(5).all()

        flash("Welcome to the admin dashboard!", "info")

        return render_template(
            'admin/index.html',
            posts=posts,
            total_users=total_users,
            recent_users=recent_users,
            search_query=search_query
        )
    except Exception as e:
        db.session.rollback() # Rollback in case of any database error during a session
        flash(f"An error occurred while loading the admin dashboard: {e}", "danger")
        # In a real application, you would also log the error:
        # from flask import current_app
        # current_app.logger.error(f"Error loading admin dashboard: {e}")
        return redirect(url_for('main.index')) # Redirect to a safe page on error