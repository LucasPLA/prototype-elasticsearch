const { Client, Authentication } = require('@zetapush/client');
const { Macro } = require('@zetapush/platform');
// ZetaPush Connection
const client = new Client({
  platformUrl: 'http://zbo.zpush.io/zbo/pub/business',
  appName: '',
  transports: require('@zetapush/cometd/lib/node/Transports'),
  authentication: () => Authentication.developer({
    login: '',
    password: ''
  })
});
// Subscribe to ZetaPush Events
const request = require('request');
client.createService({
  Type: Macro,
  listener: {
    trace: ({ data }) => {
      request({
          url: 'http://127.0.0.1:4440/',
          method: 'PUT',
          json: data
        },
        function(error){
          console.log(error);
      });
      console.log('trace', data)
    }
  }
});
// Connect to ZetaPush Platform
client
  .connect()
  .then(
    () => console.log('connected'),
    (failure) => console.log('failed', failure)
  )

/**
* apache kafka / Fluentd
* bunyan
*/
