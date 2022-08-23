const faunadb = require('faunadb');
const Ably = require('ably');

const ablyClient = new Ably.Realtime(process.env.ABLY_API_KEY);
const productsChannel = ablyClient.channels.get('app:products');

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
const allProducts = {};
let allProductsQuery = q.Map(
	q.Paginate(q.Documents(q.Collection('products'))),
	q.Lambda(x => q.Get(x))
);
client.query(allProductsQuery)
.then((products) => {
	for (const product of products.data) {
		const id = product.ref.value.id;
		allProducts[id] = product.data.name;
		ablyClient.channels.get(`app:product:${id}`).publish('update', product.data);
	}
	productsChannel.publish('products', allProducts);
})
.catch((err) => console.error(
	'Error: [%s] %s',
	err.name,
	err.message
));

function listenForProductChanges () {
	const ref = q.Documents(q.Collection("products"));
	let stream = client.stream(ref)
	.on('set', (set) => {
		let productId = set.document.ref.value.id;
		if (set.action == 'add') {
			client.query(
				q.Get(q.Ref(q.Collection('products'), `${productId}`))
			)
			.then((product) => {
				allProducts[productId] = product.data.name;
				productsChannel.publish('products', allProducts);
				ablyClient.channels.get(`app:product:${productId}`).publish('update', product);
			});
		} else {
			delete allProducts[productId];
			productsChannel.publish('products', allProducts);
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
		client.query(
			q.Get(q.Match(q.Index('customers_by_username'), username))
		).then(function(response) {
			r(response.ref.value.id);
		}).catch(function(err) {
			console.log(err);
		});
	});
}


const ordersChannel = ablyClient.channels.get('app:submit_order');

/* Listen for new order requests from clients */
ordersChannel.subscribe((msg) => {
	submitOrder(msg.clientId, msg.data);
});


const publicOrderConversion = (({ customer, cart, status, creationDate, deliveryAddress }) => 
		({ 
			customer, cart, status, creationDate, deliveryAddress 
		}));

async function submitOrder(customerId, orders) {
	client.query(
	  q.Call('submit_order', customerId, orders)
	)
	.then((ret) => {
		// Publish to decrement product value
		// Publish to create order
		const publicOrder = publicOrderConversion(ret.data);
	
		let userId = ret.data.customer.value.id;
		let orderId = ret.ref.value.id;
		ablyClient.channels.get(`app:order:${userId}:${orderId}`).publish('order', publicOrder);
		
		if (!allOrders[customerId]) allOrders[customerId] = [];
		allOrders[customerId].push(orderId);
		ablyClient.channels.get(`app:orders:${customerId}`).publish(`order`, allOrders[customerId]);
		ret.data.cart.forEach((item) => {
			client.query(
				q.Get(q.Ref(q.Collection('products'), `${item.product.value.id}`))
			)
			.then((product) => {
				ablyClient.channels.get(`app:product:${item.product.value.id}`).publish('update', product.data);
			});
		});
	})
	.catch((err) => {
		console.log(err);
		console.error(
	  'Error: [%s] %s: %s',
	  err.name,
	  err.message,
	  err.errors()[0].description,
	)}
	);
}

/* Order functions */
const allOrders = {};

let allOrdersQuery = q.Map(
	q.Paginate(q.Documents(q.Collection('orders'))),
	q.Lambda(x => q.Get(x))
);
client.query(allOrdersQuery)
.then((orders) => {
	for (const order of orders.data) {
		const orderId = order.ref.value.id;
		const customerId = order.data.customer.id;
		if (!allOrders[customerId]) allOrders[customerId] = [];
		allOrders[customerId].push(orderId);
		const publicOrder = publicOrderConversion(order.data);
		ablyClient.channels.get(`app:order:${customerId}:${orderId}`).publish('update', publicOrder);
	}
	for (const [customerId, orders] of Object.entries(allOrders)) {
		ablyClient.channels.get(`app:orders:${customerId}`).publish(`order`, orders);
	}
})
.catch((err) => console.error(
	'Error: [%s] %s',
	err.name,
	err.message
));

module.exports = createOrFindCustomer;
