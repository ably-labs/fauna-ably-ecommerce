require('dotenv').config();
const createOrFindCustomer = require('./fauna/faunaHandler.js');

const Ably = require("ably");
const realtime = new Ably.Realtime(process.env.ABLY_API_KEY);
/* Start the Express.js web server */
const express = require('express'),
      app = express(),
      cookieParser = require('cookie-parser');
app.use(cookieParser());
app.use(express.static(__dirname + '/public'));

app.listen(process.env.PORT || 3000);

app.get('/auth', async function (req, res) {
  let tokenParams;
  if (req.cookies.username) {
    const customerId = await createOrFindCustomer(req.cookies['username']);
    const ordersPattern = `app:orders:${customerId}`;
    const orderPattern = `app:order:${customerId}:*`;
    tokenParams = {
      'capability': { 
        'app:product:*': ['subscribe'],
        'app:products': ['subscribe'],
        'app:submit_order': ['publish'],
       },
      'clientId': customerId
    };
    tokenParams.capability[orderPattern] = ['subscribe'];
    tokenParams.capability[ordersPattern] = ['subscribe'];
  } else {
    /* Issue a token request with only subscribe privileges for products */
    tokenParams = {
      'capability': { 'app:product:*': ['subscribe'], 'app:products': ['subscribe'] }
    };
  }

  console.log("Sending signed token request:", JSON.stringify(tokenParams));
  realtime.auth.createTokenRequest(tokenParams, function(err, tokenRequest) {
    if (err) {
      res.status(500).send('Error requesting token: ' + JSON.stringify(err));
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify(tokenRequest));
    }
  });
});

app.get('/login', async function (req, res) {
  if (req.query['username']) {
    res.cookie('username', req.query['username']);
    res.redirect('back');
  } else {
    res.status(500).send('Username is required to login');
  }
});

/* Clear the cookie when the user logs outs */
app.get('/logout', function (req, res) {
  res.clearCookie('username');
  res.redirect('/');
});

app.get('/orders', (req, res) => {
  res.sendFile(__dirname + '/public/orders.html');
});
