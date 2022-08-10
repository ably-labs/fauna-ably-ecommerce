const faunadb = require('faunadb');
const Ably = require('ably');
const FaunaProductListener = require('./productClient.js');
const FaunaOrderListener = require('./orderClient.js');

require('dotenv').config();

const ablyClient = new Ably.Realtime(process.env.ABLY_API_KEY);
const productsChannel = ablyClient.channels.get('app:products');
const ordersChannel = ablyClient.channels.get('app:submit_order');

// Adjust for how regularly automatic stock changes occur
const RATE_OF_STOCK_CHANGE_SECONDS = 10;

/* Listen for new order requests from clients */
ordersChannel.subscribe((msg) => {
	submitOrder(msg.name, msg.data);
});

/* We need scaling clients to avoid hitting Fauna connection limits */
const clients = [];
clients.push(new FaunaProductListener(productUpdates));
const productWithName = {};

const orderClients = [];
orderClients.push(new FaunaOrderListener(orderUpdates));
const allOrders = {};

/* Setup Fauna client */
const q = faunadb.query;
let domainRegion = "";
if (process.env.FAUNA_REGION) domainRegion = `${process.env.FAUNA_REGION}.`;
client = new faunadb.Client({ 
	secret: process.env.FAUNADB_API_KEY,
	domain: `db.${domainRegion}fauna.com`,  
	scheme: 'https',
});

/* Product functions */
client.query(q.Paginate(q.Documents(q.Collection('products'))))
.then((products) => {
	for (const product of products.data) {
		addProduct(product.value.id);
	}
})
.catch((err) => console.error(
	'Error: [%s] %s',
	err.name,
	err.message
));

function listenForProductChanges () {
	const ref = q.Documents(q.Collection("products"));
	let stream = client.stream.document(ref)
	.on('set', (set) => {
		let productId = set.document.ref.value.id;
		if (set.action == 'add') {
			addProduct(productId);
		} else {
			delete productWithName[productId];
			productsChannel.publish('products', productWithName);
		}
	})
	.on('error', (error) => {
		console.log('Error:', error);
		stream.close();
		setTimeout(() => { listenForProductChanges() }, 1000);
	})
	.start();
	return stream;
}
listenForProductChanges();

function addProduct(productId) {
	for (const client of clients) {
		if (Object.keys(client.products).length < 50) {
			client.addNewProduct(productId);
			return;
		}
	}
	clients.push(new FaunaProductListener(productUpdates));
	clients[clients.length -1].addNewProduct(productId);
}

function productUpdates(productId, name) {
	if (productWithName[productId]) return;
	productWithName[productId] = name;
	productsChannel.publish('products', productWithName);
}

/* Order functions */
client.query(q.Paginate(q.Documents(q.Collection('orders'))))
.then((orders) => {
	for (const order of orders.data) {
		addOrder(order.value.id);
	}
})
.catch((err) => console.error(
	'Error: [%s] %s',
	err.name,
	err.message
));

function listenForOrderChanges () {
	const ref = q.Documents(q.Collection("orders"));
	let stream = client.stream.document(ref)
	.on('set', (set) => {
		let orderId = set.document.ref.value.id;
		if (set.action == 'add') {
			addOrder(orderId);
		}
	})
	.on('error', (error) => {
		console.log('Error:', error);
		stream.close();
		setTimeout(() => { listenForOrderChanges() }, 1000);
	})
	.start();
	return stream;
}
listenForOrderChanges();

function addOrder(orderId) {
	for (const client of orderClients) {
		if (Object.keys(client.orders).length < 50) {
			client.addNewOrder(orderId);
			return;
		}
	};
	orderClients.push(new FaunaOrderListener(orderUpdates));
	orderClients[orderClients.length -1].addNewOrder(orderId);
}

function orderUpdates(orderId, order) {
	const userId = order.customer.value.id;
	if (!allOrders[userId]) allOrders[userId] = [];
	allOrders[userId].push(orderId);
	ablyClient.channels.get(`app:orders:${userId}`).publish(`order`, allOrders[userId]);
}

function submitOrder(customerId, orders) {
	client.query(
	  q.Call('submit_order', customerId, orders)
	)
	.then((ret) => console.log(ret))
	.catch((err) => console.error(
	  'Error: [%s] %s: %s',
	  err.name,
	  err.message,
	  err.errors()[0].description,
	));
}
let stockChange = 10;
function incrementStock(quantity) {
	let productsToIncrement = [];
	for (const key in productWithName) {
		productsToIncrement.push({ productId: key, quantity: quantity });
	}
	client.query(
		q.Call('increment_stock', productsToIncrement)
	  )
	  .then((ret) => console.log(ret))
	  .catch((err) => console.error(
		'Error: [%s] %s: %s',
		err.name,
		err.message,
		err.errors()[0].description,
	  ))
}
setInterval(() => { 
	if (stockChange > 0) {
		stockChange = 0 - stockChange + Math.floor(Math.random() * 10);
	} else {
		stockChange = 10;
	}
	incrementStock(stockChange);
}, RATE_OF_STOCK_CHANGE_SECONDS * 1000);

/* Customer functions */
async function createOrFindCustomer(username) {
	/* We're hard-coding the address and other details, but for an actual
	 solution we'd get these details from the user */
	let newCustomerObject = {
		"username": username,
		"address": {
			"street": "87856 Mendota Court",
			"city": "Washington",
			"state": "DC",
			"zipCode": "20220"
		},
		"telephone": "208-346-0715",
		"creditCard": {
			"network": "Visa",
			"number": "4556781272473393"
		}
	};
	// Try to create a new customer
	return await new Promise(r => {
		createP = client.query(
			q.Create(q.Collection('customers'), { data: newCustomerObject })
		).then(function(response) {
			r(response.ref.value.id);
		})
		.catch(async () => {
			// If an existing user with this username exists, throws an error due to
			// uniqueness requirement defined within Fauna. We can find it with our username.
			let customerId = await getCustomerIdByUsername(username);
			r(customerId);
		});
	});
}

async function getCustomerIdByUsername(username) {
	// Uniqueness requirement should mean there's only 1 user with the username
	return await new Promise(r=> {
		client.paginate(q.Match(q.Index('customers_by_username'), username))
		.each(function(page) {
			r(page[0].value.id);
		});
	});
}

module.exports = { createOrFindCustomer };