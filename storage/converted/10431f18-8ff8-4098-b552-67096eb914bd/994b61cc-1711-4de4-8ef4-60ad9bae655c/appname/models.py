from flask_sqlalchemy import SQLAlchemy
db = SQLAlchemy()


class Student(db.Model):
    __tablename__ = 'student'
    name = db.Column(String, length = 100)
    email = db.Column(String, length = 254)
    age = db.Column(Integer)
    joining_date = db.Column(Date)
    photo = db.Column(String, length = 100, nullable = True)

    def __str__(self):
        return self.name