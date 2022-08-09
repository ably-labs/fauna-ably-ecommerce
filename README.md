# E-commerce demo using Ably and Fauna

This demo shows a way of getting realtime updates and interactions for customers on an e-commerce site. Users are able to login, browse items, buy them, and view their historical orders. This is done by using Fauna as a database to reliably store and query items, and Ably to reliably distribute data to clients in realtime over WebSockets.

## Setup

We will need a Fauna and Ably account, and then we can start running this project locally.

### Setup Fauna Account

Firstly, you will need a [Fauna account](https://dashboard.fauna.com/accounts/register), and to create a new Database. Populate it with the demo data by ticking the 'Use demo data' button during this process. Also ensure the region is 'Classic (C)'.

<img width="465" alt="Screenshot 2022-08-09 at 12 57 01" src="https://user-images.githubusercontent.com/9784119/183641611-bc61f137-dcb4-4550-a750-f3b9f30329f8.png">

If you choose to have the database in a specific region, you'll need to state this region in the `.env` file at the base of this directory. This will be either `eu` or `us` as the FAUNA_REGION value.

Once you have a database, create an API key for it with admin privilege by going to the 'Security' tab in the sidebar, and selecting '+ New key' in the new tab. 

<img width="1435" alt="Screenshot 2022-08-09 at 12 59 24" src="https://user-images.githubusercontent.com/9784119/183641785-c2116a52-d6c0-4bae-9440-f3e1c6dc4050.png">

Add this key to a `.env` file within the base of this directory, as `FAUNADB_API_KEY`.

Finally, we need to create a new Index in Fauna, which we can use to ensure we don't get customers with duplicate usernames. Within the Fauna database's Shell tab, run the following query:

```sh
CreateIndex({
  name: "users_by_username",
  permissions: { read: "public"},
  source: Collection("users"),
  terms: [{field: ["data", "username"]}],
  unique: true,
})
```

### Setup Ably Account

Next, we need to set up an Ably account. [Sign up for an Ably account](https://www.ably.com/signup) if you don't have one, then go to the [Ably App](https://www.ably.com/accounts/any/apps/any) you intend to use for this.

Within the app, go to the API key tab, and copy the Default API key's value. Paste this into the `.env` file you created earlier, with the name `ABLY_API_KEY`.

<img width="970" alt="Screenshot 2022-08-09 at 13 07 24" src="https://user-images.githubusercontent.com/9784119/183643358-8f08097e-d670-4212-9f82-92a644671bfb.png">

Finally, we need to create some Channel Rules, which will allow for the last message on a channel to be persisted for up to a year. This is useful for ensuring that data is always accessible to our customers. Within the Ably App, go to the 'Settings' tab, and go to the 'Channel Rules' section. Select 'Add new Rule', set the 'Namespace' to be 'app', and tick the 'Persist last message' box. Finally, click 'Create channel rule'.

<img width="993" alt="Screenshot 2022-08-09 at 13 30 46" src="https://user-images.githubusercontent.com/9784119/183647394-2b4949b3-9c21-4071-a204-d6a8cd97c57d.png">

### Running the app

With the config finished, it's time to get the app running. Firstly, run `npm install` to get the appropriate node modules. Once that's done, run:

```sh
npm run start
```

This will run the server. The server is an Express.js server. It is doing 2 things:
* Hosting endpoints which can be used by clients for viewing the site, logging in, and authenticating with Ably
* Running a connector between Ably and Fauna, allowing for certain bits of data to be accessible to customers

To view the site, simply go to `localhost:3000`.
