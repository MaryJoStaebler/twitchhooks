const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const crypto = require('crypto');
admin.initializeApp();


const verifyXHubSignature = req => {

    const digest = crypto
        .createHmac('sha256',functions.config().twitchapi.signsecret)
        .update(req.rawBody)
        .digest('hex');
    return req.headers['x-hub-signature'] === `sha256=${digest}`;
};



const app = express();
app.use(cors({origin: true}));


app.post('/', async (req,res) => {

    if(!verifyXHubSignature(req)) {
        res.status(401).send();
        return;
    }

    if(!req.body || !req.body.data || req.body.data.length === 0)
    {
        res.send(403);
        return;
    }

    const follower = req.body.data[0];
    follower.date = Date.now();
    await admin.firestore().collection('followers').doc(follower.from_name).set(follower);
    res.status(201).send();
});


app.get('/', async (req,res) => {

    const twitchCheck = {
        query: req.query,
        date: Date.now()
    }
    await admin.firestore().collection('twitchhooked').add(twitchCheck);
    res.type('text/plain').status(201).send(req.query['hub.challenge']);
});

app.get('/:numOf', async(req,res) => {
    const snapshot = await admin.firestore().collection('followers').limit(parseInt(req.params.numOf)).get();

    let followers = [];
    snapshot.forEach(follower => {
        let id = follower.id;
        let data = follower.data();
        followers.push({id, ...data});
    });

    res.status(200).send(JSON.stringify(followers));
});

exports.followers = functions.https.onRequest(app);



async function getOAuthHeaders() {


    let auth_token = await admin.firestore().collection('twitchOAuth').doc('authToken').get();

    if(!auth_token.exists)
    {
        await getOAuthToken();
        auth_token = await admin.firestore().collection('twitchOAuth').doc('authToken').get();
    }

   const tokenData = auth_token.data();
   return   {
       'Client-ID':functions.config().twitchapi.clientid,
            'Authorization': `Bearer ${tokenData['access_token']}`
        };

}

async function getOAuthToken() {

    let fetch = require('node-fetch');
    const post_vars = `client_id=${functions.config().twitchapi.clientid}&client_secret=${functions.config().twitchapi.secret}&grant_type=client_credentials`;
    const response = await fetch(`https://id.twitch.tv/oauth2/token?${post_vars}`, {
        method: 'post'
    });

    const token = await response.json();
    await admin.firestore().collection('twitchOAuth').doc('authToken').set(token);

    return token;
}

async function getStreamer() {

    let fetch = require('node-fetch');

    const twitchurl = `https://api.twitch.tv/helix/users?login=${functions.config().twitchapi.username}`;

    let headers = await getOAuthHeaders();
    const response = await fetch(twitchurl,{
        headers:headers
    });

    const user = await response.json();
    await admin.firestore().collection('twitchOAuth').doc('streamer').set(user.data[0]);

    return user.data[0];

}


const startHookServer = express();
startHookServer.use(cors({origin:true}));
startHookServer.get('/',async(req,res) => {

    let headers = await getOAuthHeaders();
    headers['Content-Type'] = 'application/json';

    let user = await getStreamer();
    let fetch = require('node-fetch');
    const body = {
       'hub.secret':functions.config().twitchapi.signsecret,
        'hub.lease_seconds':86400,
        'hub.topic':`https://api.twitch.tv/helix/users/follows?first=1&to_id=${user.id}`,
        'hub.callback':`${functions.config().twitchapi.serverurl}/twitchhooks-6666e/us-central1/followers`,
        'hub.mode':'subscribe'
    };
    const response = await fetch('https://api.twitch.tv/helix/webhooks/hub', {
        method:'post',
        body:JSON.stringify(body),
        headers: headers
    });

    res.send(response.statusCode);

});

exports.start = functions.https.onRequest(startHookServer);
