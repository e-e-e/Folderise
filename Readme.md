# Folderise

Folderise is a express middleware to create static (or semi-static) websites from a folder of markdown files.

Folderise was developed for Frontyard Project's [website](www.frontyardprojects.org) as a simple way for multiple authors to easily modify the organisations website. We used a shared dropbox folder, so that any changes to the files/folders immediately caused the website to update.

**Guide:**

* Every folder becomes a page. The title of the folder is the name of the page. 
* Any .md file included in a folder will be parsed as Markdown and rendered in alphabetic order.
* After .md files, if there are other files they will rendered as download links.
* Any image will be served as an image at the bottom of the page.
* Any folders, files, or images that begin with a . or an _ will not be rendered.
* Listings will be alphabetical.
* The sites pages are cached in _tmp.html files inside each folder.
* Folderise uses ckokidar to listen for any changes to the website folder and automatically rerenders any changes.
* template.html is used as the base folder

Folderise is a based on the python static website generator [Folders](https://github.com/sdockray/folders).

**Still to do:**

* enable template to be overriden in settings.
* include .css or .less

## Install:

```sh 
npm install folderise
```

Folderise requires a settings.json file with the following options:

```js
{
	"port": /* port for server to listen on */,
	"title": /*  title of your site */,
	"folder": /* path/to/folder */,
	"plugins": [ /* list of plugins */ ]
}
```

Check out the example provided for how to intergate Folderise into your express application.

```js
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
```

**Note:** If not using any folderise plugins you can increase performance by using Nginx to serve static content.