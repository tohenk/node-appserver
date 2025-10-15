# Node.js App Server

App Server aimed to provide connectivity between frontend (browser) and
backend (server), but not limited to that setup. Currently the supported
connectivities are [socket.io](https://socket.io) and XMPP protocol.

App Server includes two example apps, a messaging connector and a report
generator.

## Messaging Connector

Messaging connector [`app/ntmsg.js`](https://github.com/tohenk/node-appserver/blob/master/app/ntmsg.js)
provides the following functionality:

* Manage connected clients, to provide real time notification between users.
* A proxy for [SMS GATEWAY APP](https://github.com/tohenk/node-sms-gw) to
  provide SMS functionality to app.
* Enrich application functionality with web API execution or backend
  integration (such as account synchronisation).

## Report Generator

Report Generator [`app/ntreport.js`](https://github.com/tohenk/node-appserver/blob/master/app/ntreport.js)
utilize [PHP-NTREPORT](https://github.com/tohenk/php-ntreport) for generating reports.
