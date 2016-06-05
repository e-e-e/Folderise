/* jshint esnext:true, globalstrict:true */
/* global require, console, __dirname */

"use strict";

// libraries needed for serving content
var express	= require('express');
var helmet	= require('helmet');
var bodyParser = require('body-parser');
var errorHandler = require('errorhandler');

var options = require('./settings.json');
var folderise = require("folderise")(options);

var port = options.port;
var app = express();

app.use(helmet());
app.use(helmet.noCache());
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(errorHandler());

app.use('/', express.static(options.folder));
app.use(folderise.middleman() );
app.get('*', folderise.serve() );

app.listen(port, function() {
  console.log('Express server listening on port ' + port);
});