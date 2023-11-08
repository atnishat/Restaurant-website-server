const express = require('express');
const cors = require('cors');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const nodemailer = require("nodemailer");
const mg = require('nodemailer-mailgun-transport');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;
const app = express();


// middleware
app.use(cors());
app.use(express.json());





const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster1.mpiyq8b.mongodb.net/?retryWrites=true&w=majority`;
// console.log(uri);
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });



function verifyJWT(req, res, next) {

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('unauthorized access');
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
    })

}







function sendBookingEmail(booking) {
    const { email, reservationDate, slot } = booking;

    const auth = {
        auth: {
            api_key: process.env.EMAIL_SEND_KEY,
            domain: process.env.EMAIL_SEND_DOMAIN
        }
    }

    const transporter = nodemailer.createTransport(mg(auth));


    transporter.sendMail({
        from: "atnishat09@gmail.com", // verified sender email
        to: email || 'atnishat09@gmail.com', // recipient email
        subject: `Your appointment for ${slot} is confirmed`, // Subject line
        text: "Hello world!", // plain text body
        html: `
        <h3>Your appointment is confirmed</h3>
        <div>
            <p>You take an appointment for ${slot}</p>
            <p>Please visit Tasnim Cuisine on ${reservationDate} at ${slot}</p>
            <p>Thank You.</p>
        </div>
        
        `, // html body
    }, 
    function (error, info) {
        if (error) {
            console.log('Email send error', error);
        } else {
            console.log('Email sent: ' + info);
        }
    });
}



























async function run() {
    try {
        const ServicesCollection = client.db('restaurant-web').collection('Services');
        const bookingsCollection = client.db('restaurant-web').collection('bookings');
        const usersCollection = client.db('restaurant-web').collection('users');
        const menuCollection = client.db('restaurant-web').collection('menus');
        const paymentCollection = client.db('restaurant-web').collection('payment');



        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await usersCollection.findOne(query);

            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }








        app.get('/services', async (req, res) => {
            const date = req.query.date;
            const query = {};
            const options = await ServicesCollection.find(query).toArray();

            // get the bookings of the provided date
            const bookingQuery = { reservationDate: date }
            // console.log(bookingQuery);
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();
            // console.log(alreadyBooked);

            // code carefully :D
            options.forEach(option => {
                // console.log(option);
                const optionBooked = alreadyBooked.filter(book => book.ReservationOf === option.name);
                // console.log(book);
                // console.log(optionBooked);
                const bookedSlots = optionBooked.map(book => book.slot);
                // console.log(option.name, bookedSlots);
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlots;
            })
            res.send(options);
        });


        app.get('/bookings', async (req, res) => {
            // const email = req.query.email;
            // const decodedEmail = req.decoded.email;
            // if (email !== decodedEmail) {
            //     return res.status(403).send({ message: 'forbidden access' });
            // }
            const query = {}
            const booking = await bookingsCollection.find(query).toArray();
            // console.log(booking);
            res.send(booking);
        });

        app.get('/allbookings/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingsCollection.findOne(query);
            res.send(booking);
        })





        app.get('/bookings/email', verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            // console.log(decodedEmail)
            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            const query = { email: email };
            const bookings = await bookingsCollection.find(query).toArray();
            // console.log(bookings);
            res.send(bookings);
        })




        app.post('/bookings', async (req, res) => {
            const booking = req.body;
            // console.log(booking);
            const query = {
                reservationDate: booking.reservationDate,
                email: booking.email,
                // ReservationOf: booking.ReservationOf
            }

            const alreadyBooked = await bookingsCollection.find(query).toArray();

            if (alreadyBooked.length) {
                const message = `You already have a booking on ${booking.reservationDate}`
                return res.send({ acknowledged: false, message })
            }

            const result = await bookingsCollection.insertOne(booking);
            sendBookingEmail(booking);
            res.send(result);
        })


        app.post('/create-payment-intent', async (req, res) => {
            const booking = req.body;
            // console.log(booking)
            const price = booking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                currency: 'usd',
                amount: amount,
                "payment_method_types": [
                    "card"
                ]
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });


        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const result = await paymentCollection.insertOne(payment);
            const id = payment.bookingId
            const filter = { _id: ObjectId(id) }
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const updatedResult = await bookingsCollection.updateOne(filter, updatedDoc)
            res.send(result);
        })

        app.get('/payment', async (req, res) => {
            const query = {};
            const users = await paymentCollection.find(query).toArray();
            res.send(users);
        });




        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '21h' })
                return res.send({ accessToken: token });
            }
            res.status(403).send({ accessToken: '' })
        });








        app.get('/users', async (req, res) => {
            const query = {};
            const users = await usersCollection.find(query).toArray();
            res.send(users);
        });


        app.post('/users', async (req, res) => {
            const user = req.body;
            console.log(user);
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            res.send({ isAdmin: user?.role === 'admin' });
        })

        app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) }
            const options = { upsert: true };
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updatedDoc, options);
            res.send(result);
        })

        // add verifyjwt in all menus api.........................
        app.get('/menus', async (req, res) => {
            const query = {};
            const menus = await menuCollection.find(query).toArray();
            res.send(menus);
        })
        // verifyJWT, verifyAdmin, 
        app.post('/menus', async (req, res) => {
            const menus = req.body;
            const result = await menuCollection.insertOne(menus);
            res.send(result);
        });


        app.delete('/menus/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const result = await menuCollection.deleteOne(filter);
            res.send(result);
        })












    }


















    finally {

    }
}
run().catch(console.log);

app.get('/', async (req, res) => {
    res.send('Restaurant web server is running');
})

app.listen(port, () => console.log(`restaurant web running on ${port}`))