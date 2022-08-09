const faunadb = require('faunadb');
const Ably = require('ably');
require('dotenv').config();
const q = faunadb.query;

/* 
This class listens for changes in order items in Fauna, and sends them to Ably post-filtering 
for clients to subscribe to and update accordingly
*/
class FaunaOrderListener {
	constructor(callback) {
		// Setup Fauna
		this.faunaClient = new faunadb.Client({ 
			secret: process.env.FAUNADB_API_KEY,
			// Change this to match whichever region your instance is in
			domain: 'db.eu.fauna.com',  
			scheme: 'https',
		});
		this.orders = {};

		this.orderUpdatesCallback = callback;

		// Setup Ably
		this.ablyClient = new Ably.Rest(process.env.ABLY_API_KEY);
	}

	addNewOrder(orderId) {
        if (!this.orders[orderId]) this.orders[orderId] = {};
		this.orders[orderId]['stream'] = this.startStream(orderId);
	}

	removeOrder(orderId) {
		delete this.orders[orderId];
	}

	startStream (orderId) {
		const ref = q.Ref(q.Collection("orders"), `${orderId}`);
		let stream = this.faunaClient.stream.document(ref)
		.on('snapshot', (snapshot) => {
            const publicOrder = (({ customer, cart, status, creationDate, deliveryAddress }) => 
                ({ 
                    customer, cart, status, creationDate, deliveryAddress 
                }))(snapshot.data);
			this.publishToAbly(orderId, 'update', publicOrder);
			this.orderUpdatesCallback(orderId, publicOrder);
		})
		.on('version', (version) => {
			if (version.action == 'delete') {
				stream.close();
				this.removeOrder(orderId);
			}
            const publicOrder = (({ customer, cart, status, creationDate, deliveryAddress }) => 
            ({ 
                customer, cart, status, creationDate, deliveryAddress 
            }))(snapshot.data);
			this.publishToAbly(orderId, version.action, publicOrder);
			this.orderUpdatesCallback(orderId, publicOrder);
		})
		.on('error', (error) => {
			console.log('Error:', error);
			stream.close();
			setTimeout(() => { this.startStream(orderId) }, 1000);
		})
		.start();
		return stream;
	}

	publishToAbly(orderId, name, data) {
        const userId = data.customer.value.id;
		/* The channel structure allows for limiting users to only be able to access channels with
		their userId included, ensuring no one can see other user's orders and details */
		this.ablyClient.channels.get(`order:${userId}:${orderId}`).publish(name, data);
	}
}

module.exports = FaunaOrderListener;