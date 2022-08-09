const Ably = require("ably");
const { createOrFindCustomer } = require('./fauna/faunaHandler.js');

const realtime = new Ably.Realtime(process.env.ABLY_API_KEY);

/* Start the Express.js web server */
const express = require('express'),
      app = express(),
      cookieParser = require('cookie-parser');

app.use(cookieParser());
app.use(express.static(__dirname + '/public'));
app.get('/auth', function (req, res) {
  var tokenParams;
  if (req.cookies.username) {
    const ordersPattern = `app:orders:${req.cookies.userId}`;
    const orderPattern = `app:order:${req.cookies.userId}:*`;
    tokenParams = {
      'capability': { 
        'app:product:*': ['subscribe'],
        'app:products': ['subscribe'],
        'app:submit_order': ['publish'],
       },
      'clientId': req.cookies.username
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

/* Set a cookie when the user logs in. In a proper auth system, 
this'd be a unique string which we can use to validate the user in
the auth process above
*/
app.get('/login', async function (req, res) {
  if (req.query['username']) {
    let customerId = await createOrFindCustomer(req.query['username']);
    console.log(customerId);
    res.cookie('username', req.query['username']);
    res.cookie('userId', `${customerId}`);
    res.redirect('back');
  } else {
    res.status(500).send('Username is required to login');
  }
});

app.get('/orders', (req, res) => {
  res.sendFile(__dirname + '/public/orders.html');
});

/* Clear the cookie when the user logs outs */
app.get('/logout', function (req, res) {
  res.clearCookie('username');
  res.redirect('/');
});

app.listen(process.env.PORT || 3000);