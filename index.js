// libraries for processing folders
/* jshint esnext:true, globalstrict:true */
/* global require, __dirname, exports, module, console, escape */
"use strict";

var Q = require('q');
var fs = require('fs');
var path = require('path');
var fs_stat = Q.denodeify(fs.stat);
var fs_readdir = Q.denodeify(fs.readdir);
var fs_readFile = Q.denodeify(fs.readFile);
var fs_writeFile = Q.denodeify(fs.writeFile);
var fs_unlink = Q.denodeify(fs.unlink);

var chokidar = require('chokidar');
var marked = require('marked');
marked.setOptions({ gfm:true,	breaks: true });

var escape_markdown = require('./markdown-escape');
var mmm = require('mmmagic');
var magic = new mmm.Magic(mmm.MAGIC_MIME_TYPE);

function get_mimetype(dir) {
	var deferred = Q.defer();
	magic.detectFile(dir, deferred.makeNodeResolver());
	return deferred.promise;
}

function markdown_to_html (str,options) {
	var deferred = Q.defer();
	marked(str,options, deferred.makeNodeResolver());
	return deferred.promise;
}

/*global exports:true*/
exports = module.exports = makeFolderise;

function makeFolderise (options) {
	return new Folderise(options);
}

function Folderise (options) {
	
	//public options

	this.settings = parse_options(options);
	var settings = this.settings;

	//setup plugins
	
	this.plugins = (options.plugins) ? load_plugins(options.plugins) : {};
	var plugins = this.plugins;

	//private variables
	if(this.settings.refresh) {
		remove_cache_at(settings.folder, "restarted so clearing cached files.");
	}
	if(this.settings.watch) {
		setup_watcher();
	}

	//public functions

	this.serve = function () {
		//if _tmp.html exists - serve it
		return (req,res) => {
			var dir = req.params[0];
			var fullpath = path.join(this.settings.folder, dir, '_tmp.html');
			res.type('html');
			var file = fs_readFile(fullpath, {encoding:'utf8'})
				.catch(err => {
					console.log('parsing');
					return this.parse(dir);
				}).then( html => {
					var plugins_found = [];
					iter_over_plugins(html, (plugin) => {
						if(plugin in plugins) {
							plugins_found.push(plugins[plugin].execute());
						} else {
							plugins_found.push(Q(`${plugin} is not installed`));
						}
					});
					return Q.all([Q(html),Q.all(plugins_found)]);
				})
				.spread( (html, plugins) => {
					var i = 0;
					res.send(html.replace(/\{\{@(\w+)}}/g, () => plugins[i++]));
				}).catch(err=> res.send(err));
			// var stream = 	fs.createReadStream(fullpath, {encoding:'utf8'})
			// .on('error', err => {
			// 	//else parse and return results.
			// 	console.log('parsing');
			// 	this.parse(dir)
			// 		.then( html => res.send(html.replace(/\{\{@(\w+)}}/g,plugin_filter)))
			// 		.catch(err=> res.send(err));
			// })
			// .pipe(replaceStream(/\{\{@(\w+)}}/g,plugin_filter,{maxMatchLen:20}))
			// .pipe(res);
			// console.log('serving');
		};

		function iter_over_plugins(html,fn) {
			var tmp = html;
			var regex = /\{\{@(\w+)}}/g;
			var match = regex.exec(tmp);
			var n = 0;
			while (match !== null) {
				fn(match[1],n);
				n++;
				match = regex.exec(tmp);
			}
		}

		function plugin_filter (match, plugin) {
			if(plugin in plugins) return plugins[plugin].execute();
			else return `${plugin} is not installed check your config`;
		}
	};

	this.middleman = function() { 
		return function(req,res, next) {
			//execute any neccessary functions for plugins -
			var middlemen = [];
			for(var plugin in plugins) {
				var v = plugins[plugin];
				if(v.middleman) middlemen.push(v.middleman(req,res));
			}
			Q.all(middlemen)
				.then( () => next())
				.catch(err=> {console.log(err); next(); });
		};
	};

	this.parse = function parse (dir, callback) {
		//set context
		var ctx = {
			folder: this.settings.folder,
			url: dir,
			title: this.settings.title,
			dir: path.join(this.settings.folder, dir),
			html:'',
			texts: [],
			links: [],
			images:[],
			downloads:[]
		};

		var promise = fs_stat( ctx.dir )
			.then( list_dir.bind(null,ctx) )
			.then( categorise_files.bind(null,ctx) )
			.then( load_template.bind(null,ctx) )
			.then( render_html.bind(null,ctx) )
			.then( cache_results.bind(null,ctx) )
			.then( r => ctx.html); //return html

		if(callback) 
			promise.catch( callback )
				.done( results => callback(null, results) );
		else return promise;
	};

	// private functions

	function parse_options (options) {
		// set defaults for folderise
		if(options.folder === undefined) {
			throw new Error('Need to define folder in options');
		}

		return {
			folder : options.folder,
			title : options.title || '',
			watch : options.watch || true,
			refresh : options.refresh || true
		};
	}

	function load_plugins(names) {
		var plugins = {};
		for(var i = 0; i<names.length; i++){
			var n = names[i].name;
			var options = names[i].options;
			plugins[n] = require(n)(options);
		}
		return plugins;
	}

	function setup_watcher() {
		var watcher = chokidar.watch(settings.folder, {
			ignored: /\/(_|\.)/,
			persistent: true
		});

		watcher
		.on('ready', () => {
			console.log('Initial scan complete. Ready for changes');
			watcher.on('add', path => remove_cache_at( path, `File ${path} has been added`))
			.on('change', path => remove_cache_at( path,`File ${path} has been changed`))
			.on('unlink', path => remove_cache_at( path,`File ${path} has been removed`))
			.on('addDir', path => remove_cache_at( path,`Directory ${path} has been added`))
			.on('unlinkDir', path => remove_cache_at( path,`Directory ${path} has been removed`));
		});
	}

	// private functions for use by parse

	function list_dir (ctx, stat) {
		if(stat.isDirectory()) {
			return fs_readdir(ctx.dir);
		} else {
			throw new Error('URL is not a Folder');
		}
	}
	function categorise_files (ctx, files) {
		return files.filter( file => (file.match(/^(\.|_)/) === null) )
			.reduce( (sequence, file) => {
				return sequence.then(categorise_file.bind(null,ctx,file));
			}, Q());
		//return Q.all( files.map(categorise_file.bind(null,ctx)));
	}

	function categorise_file(ctx,file) {
		var fullpath = path.join(ctx.dir,file);
		return get_mimetype( fullpath )
			.then( mimetype => {
				if(is_directory(mimetype)) { // directory
					ctx.links.push(file);
				} else if (is_image(mimetype)) { // image
					ctx.images.push(file);
				} else if (is_download(mimetype)) { // download
					ctx.downloads.push(file);
				} else if (is_markdown(mimetype,file)) { // markdown
					ctx.texts.push(file);
				}
			});
	}

	function is_markdown(mimetype, file) {
		return ( path.extname(file) === '.md' && mimetype === 'text/plain' );
	}

	function is_image(mimetype) {
		return mimetype.indexOf('image/') === 0;
	}
	function is_download(mimetype) {
		return mimetype.indexOf('application/') === 0;
	}
	function is_directory(mimetype) {
		return mimetype.indexOf('directory') >= 0;
	}

	function render_html(ctx) {
		var sections = [ 
				render_navigation(ctx),
				render_content(ctx),
				render_images(ctx), 
				render_downloads(ctx)
			];
		return Q.all(sections)
						.spread(function(navigation,content,images,downloads){
							replace_template(ctx,'title', ctx.title);
							replace_template(ctx,'navigation',navigation);
							replace_template(ctx,'content',content);
							replace_template(ctx,'images',images);
							replace_template(ctx,'downloads',downloads);
							return ctx.html;
						});
	}

	function load_template(ctx) {
		return fs_readFile(path.join(__dirname,'template.html'),'utf8')
			.then( file => ctx.html = file );
	}

	function replace_template(ctx, section, chunk ) {
		var regex = new RegExp('{{'+escapeRegExp(section)+'}}','g');
		ctx.html = ctx.html.replace( regex, chunk);
		return ctx.html;
	}

	function render_navigation (ctx) {
	return get_base_folders(ctx)
		.then(folders => {
				//console.log(path)
				var nav = '## | ';
				var breadcrumb = ctx.url.split(path.sep).filter( f => f.length>0 );
				nav += (breadcrumb.length) ? make_link('home', '/') : '~~home~~';
				return nav +	folders.reduce( (str,folder) => {
					str += ' | ';
					if( folder === breadcrumb[0]) {
						//str+=' **' + make_link(folder, path.join('/',folder));
						var trail = '';
						for( var i = 0; i<breadcrumb.length; i++) {
							trail += '/'+ breadcrumb[i];
							if (i > 0 ) str += ' / ';
							str += (i<breadcrumb.length-1) ?
								make_link(breadcrumb[i], path.join('/',trail))
								: '~~'+ breadcrumb[i] +'~~';
						}
					} else {
						str += make_link(folder, path.join('/',folder));
					}
					return str;
				}, '') + ' | ##';
		})
		.then(str => {
			var links = '';
			console.log(ctx.url);
			if(ctx.links.length && ctx.url !== '/') {
				links += ' \n### extra: ' + 
					ctx.links.map( e => make_link(e, path.join(ctx.url,e))).join(' | ');
			}
			return str + links;
		})
		.then(markdown_to_html);
	//make a header of top level folders
	}

	function make_link(name,dir) {
		return "["+name+"]("+ dir+")";
	}

	function get_base_folders (ctx) {
		return fs_readdir(ctx.folder)
			.then( files => {
				var promises = files.filter( 
					file => (file.match(/^(\.|_)/) === null) 
				).map( file => {
					return fs_stat( path.join(ctx.folder,file))
						.then( stat => [file,stat] );
				});
				return Q.all(promises);
			})
			.then( results => {
				return results.filter((e, i) => e[1].isDirectory())
								.map( e => e[0] );
			});
	}

	function render_content (ctx) {
		//return "content";
		return Q.all( ctx.texts.map( text => {
				return fs_readFile(path.join(ctx.dir,text), 'utf8')
								.then(markdown_to_html);
			})).then( renders => { return renders.join(' '); });
	}

	function render_images (ctx) {
		var text = (ctx.images.length)?"### Images \n":''; 
		text += ctx.images.reduce( (md, file) => { 
			var f = path.join(ctx.url,escape(file));
			return md += `[![${escape_markdown(file)}](${f})](${f})\n`;
		},'');
		return markdown_to_html(text);
	}

	function render_downloads (ctx) {
		var text = (ctx.downloads.length)?"### Resources \n":'';
		text += ctx.downloads.reduce( (md, file) => { 
			var f = path.join(ctx.url,escape(file));
			console.log(`+ [${escape_markdown(file)}](${f})\n`);
			return md += `+ [${escape_markdown(file)}](${f})\n`;
		},'');
		return markdown_to_html(text);
	}

	function cache_results(ctx, html) {
		var file = path.join(ctx.dir, '_tmp.html');
		return fs_writeFile( file, html,'utf8')
						.catch(err=> console.log('CANNOT WRITE FILE'));
	}

	function remove_cache_at(dir, log) {
		if(log) console.log(log);
		var base = path.dirname(dir);
		var item = path.relative(settings.folder,dir);
		var parent = path.dirname(item);
		if (parent === '.') {
			console.log("Recursively removing all temporary files");
			fs_walk(base, unlink_tmp ).catch(err=> console.log(err.stack));
		} else { // remove singular
			console.log(`${item} changed! so removing ${path.join(base,'_tmp.html')}`);
			return unlink_tmp(base);
		}
	}

	function unlink_tmp(dir) {
		return fs_unlink(path.join(dir,'_tmp.html'))
						.catch(err=> {}); //silence errors
	}

	function escapeRegExp(str) {
		return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
	}

}

function fs_walk(dir, fn) {
	if(typeof(fn) === 'function') fn(dir);
	return fs_readdir(dir)
		.then( files => Q.all(files.map( file => fs_stat( path.join(dir,file)) ))
											.then(stats => [files,stats]))
		.spread( (files,stats) => {
			return files.filter( (e,i) => stats[i].isDirectory() );
		}).then(folders => {
			return Q.all(folders.map(folder => {
				var next_dir = path.join(dir, folder);
				return fs_walk(next_dir, fn);
			}));
		});
}

