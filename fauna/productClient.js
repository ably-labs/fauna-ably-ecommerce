const faunadb = require('faunadb');
const Ably = require('ably');
require('dotenv').config();
const q = faunadb.query;

class FaunaProductListener {
	constructor(callback) {
		// Setup Fauna
		this.faunaClient = new faunadb.Client({ 
			secret: process.env.FAUNADB_API_KEY,
			// Change this to match whichever region your instance is in
			domain: 'db.eu.fauna.com',  
			scheme: 'https',
		});
		this.products = {};

		this.productUpdatesCallback = callback;

		// Setup Ably
		this.ablyClient = new Ably.Rest(process.env.ABLY_API_KEY);
	}

	addNewProduct(productId) {
		if (!this.products[productId]) this.products[productId] = {};
		this.products[productId]['stream'] = this.startStream(productId);
	}

	removeProduct(productId) {
		delete this.products[productId];
	}

	startStream (productId) {
		const ref = q.Ref(q.Collection("products"), `${productId}`);
		let stream = this.faunaClient.stream.document(ref)
		.on('snapshot', (snapshot) => {
			this.publishToAbly(productId, 'update', snapshot.data);
			this.productUpdatesCallback(productId, `${snapshot.data.name}`);
		})
		.on('version', (version) => {
			if (version.action == 'delete') {
				stream.close();
				this.removeProduct(productId);
			}
			this.publishToAbly(productId, version.action, version.document.data);
			this.productUpdatesCallback(productId, `${version.document.data.name}`);
		})
		.on('error', (error) => {
			console.log('Error:', error);
			stream.close();
			setTimeout(() => { this.startStream(productId) }, 1000);
		})
		.start();
		return stream;
	}

	publishToAbly(productId, name, data) {
		this.ablyClient.channels.get(`product:${productId}`).publish(name, data);
	}
}

module.exports = FaunaProductListener;