from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from flask_login import login_required, current_user
from models import db

app = Flask(__name__)

@app.route('/about', methods=['GET'])
def about():
    return render_template('about.html')

@app.route('/resultView', methods=['GET', 'POST'])
def resultView():
    if request.method == 'POST':
        roll = request.form.get('roll')
    
        flash('Operation successful', 'success')
    
        return redirect(url_for('resultView'))
    
    return render_template('result.html')

@app.route('/contact', methods=['GET'])
def contact():
    return render_template('contact.html')

