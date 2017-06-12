/*jshint loopfunc: true */
var mocha     = require('mocha'),
    _         = require('lodash'),
    uuid      = require('node-uuid'),
    chalk     = require('chalk'),
    Highlight = require('highlight.js'),
    reportGen = require('./reportGenerator'),
    stringify = require('json-stringify-safe'),
    conf      = require('./config'),
    templates = require('./templates.js'),
    opener    = require('opener');

var path = require('path');
var fs = require('fs');
var xml = require('xml');
var crypto = require('crypto');

function md5 (text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

var Base = mocha.reporters.Base,
    generateReport = reportGen.generateReport,
    saveToFile = reportGen.saveToFile,
    totalTestsRegistered;

Highlight.configure({
  useBR: true,
  languages: ['javascript']
});

module.exports = Mochawesome;

/**
 * Initialize a new reporter.
 *
 * @param {Runner} runner
 * @api public
 */

function Mochawesome (runner, options) {
  // Reset total tests counter
  totalTestsRegistered = 0;

  // Create/Save necessary report dirs/files
  var reporterOpts = options.reporterOptions || {},
      config = conf(reporterOpts);

  generateReport(config);

  var self = this;
  Base.call(self, runner);

  // Show the Spec Reporter in the console
  new mocha.reporters.Spec(runner);

  var allSuites = {},
      allTests = [],
      allPending = [],
      allFailures = [],
      allPasses = [],
      endCalled = false;

  var arrSuites = [];

  runner.on('suite end', function (suite) {
    if(suite && suite.tests.length > 0){
      arrSuites.push(suite);
    }
  });

  runner.on('test end', function (test) {
    allTests.push(test);
  });

  runner.on('pending', function (test) {
    allPending.push(test);
  });

  runner.on('pass', function (test) {
    allPasses.push(test);
  });

  runner.on('fail', function (test){
    allFailures.push(test);
  });

  runner.on('end', function () {
    try {
      if (!endCalled) {
        endCalled = true; // end gets called more than once for some reason so this ensures we only do this once

        allSuites = self.runner.suite;

        allSuites.suites = arrSuites;

        traverseSuites(allSuites, config);

        // save JUnit
        saveToFile(getJUnit(allSuites), config.reportJUnitFile, function(){});

        var obj = {
          reportTitle: config.reportTitle || process.cwd().split(config.splitChar).pop(),
          inlineAssets: config.inlineAssets,
          stats: self.stats,
          suites: allSuites,
          allTests: allTests.map(cleanTest),
          allPending: allPending.map(cleanTest),
          allPasses: allPasses.map(cleanTest),
          allFailures: allFailures.map(cleanTest),
          copyrightYear: new Date().getFullYear()
        };

        obj.stats.testsRegistered = totalTestsRegistered;

        var passPercentage = Math.round((obj.stats.passes / (obj.stats.testsRegistered - obj.stats.pending))*1000)/10;
        var pendingPercentage = Math.round((obj.stats.pending / obj.stats.testsRegistered)*1000)/10;

        obj.stats.passPercent = passPercentage;
        obj.stats.pendingPercent = pendingPercentage;
        obj.stats.other = (obj.stats.passes + obj.stats.failures + obj.stats.pending) - obj.stats.tests;
        obj.stats.hasOther = obj.stats.other > 0;
        obj.stats.skipped = obj.stats.testsRegistered - obj.stats.tests;
        obj.stats.hasSkipped = obj.stats.skipped > 0;
        obj.stats.failures = obj.stats.failures - obj.stats.other;
        obj.stats.passPercentClass = _getPercentClass(passPercentage);
        obj.stats.pendingPercentClass = _getPercentClass(pendingPercentage);

        var runtime = process.env.runtime || '';
        var hostsPath = 'hosts' + (runtime ? '-'+runtime : '');
        var hostsFile = path.resolve('./' + hostsPath);

        var hosts = '';
        if(fs.existsSync(hostsFile)){
          hosts = '# File name: '+ hostsPath + '\r\n# ---------------------------------------------------------------------------------------\r\n\r\n' +fs.readFileSync(hostsFile).toString();
        }
        obj.hosts = hosts;

        if (!templates.mochawesome) {
          console.error('Mochawesome was unable to load the template.');
        }

        saveToFile(stringify(obj, null, 2), config.reportJsonFile, function(){});
        saveToFile(templates.mochawesome(obj), config.reportHtmlFile, function() {
          console.log('\n[' + chalk.gray('mochawesome') + '] Report saved to ' + config.reportHtmlFile);
          console.log('[' + chalk.gray('mochawesome') + '] Report saved to ' + config.reportJUnitFile + '\n\n');
          if (config.autoOpen) {
            opener(config.reportHtmlFile);
          }
          if(obj && obj.stats.tests > 0){
            process.exit(0);
          }
        });
      }
    } catch (e) { //required because thrown errors are not handled directly in the event emitter pattern and mocha does not have an "on error"
      console.error('Problem with mochawesome: %s', e.stack);
    }
  });

}

function getJUnit(allSuites){
  var arrTestSuites = [];
  allSuites.suites.forEach(function(suite){
    var tests = suite.tests;
    var arrTestSuite = [
      {
        _attr: {
          name: suite.title.replace(/\./g, '_').replace(/\s+:\s+/g, '.'),
          timestamp: new Date().toISOString().slice(0,-5),
          tests: 1
        }
      }
    ];
    var testcase = [{
        _attr: {
          name:  'UIRecorder tests',
          time: suite.duration / 1000
        },
      }
    ];
    tests.forEach(function(test, i){
      var err = test.err;
      if(err || test.skipped || test.pending){
        testcase.push({
          failure: {
            _cdata: err ? err.message + '\r\n\r\n' + test.rawCode : 'skipped!'
          }
        });
      }
    });
    arrTestSuite.push({
      testcase: testcase
    });
    arrTestSuites.push({
      testsuite: arrTestSuite
    });
  });
  return xml({
    testsuites: arrTestSuites
  }, { declaration: true, indent: '  ' });
}

/**
 * HELPER FUNCTIONS
 */

/**
 * Do a breadth-first search to find
 * and format all nested 'suite' objects.
 *
 * @param {Object} suite
 * @api private
 */

function traverseSuites (suite, config) {
  var queue = [],
      next = suite;
  while (next) {
    if (next.root) {
      cleanSuite(next);
    }
    if (next.suites.length) {
      _.each(next.suites, function(suite, i) {
        cleanSuite(suite, config);
        queue.push(suite);
      });
    }
    next = queue.shift();
  }
}

/**
 * Modify the suite object to add properties needed to render
 * the template and remove properties we do not need.
 *
 * @param {Object} suite
 * @api private
 */

function cleanSuite (suite, config) {
  suite.uuid = uuid.v4();

  copyScreenShots(suite.tests);

  var cleanTests = _.map(suite.tests, cleanTest);
  var passingTests = _.where(cleanTests, {state: 'passed'});
  var failingTests = _.where(cleanTests, {state: 'failed'});
  var pendingTests = _.where(cleanTests, {pending: true});
  var skippedTests = _.where(cleanTests, {skipped: true});
  var duration = 0;

  _.each(cleanTests, function (test) {
    duration += test.duration;
  });

  totalTestsRegistered += suite.tests ? suite.tests.length : 0;

  suite.tests = cleanTests;
  suite.fullFile = suite.file || '';
  suite.file = suite.file ? suite.file.replace(process.cwd(), '') : '';
  suite.passes = passingTests;
  suite.failures = failingTests;
  suite.pending = pendingTests;
  suite.skipped = skippedTests;
  suite.hasTests = suite.tests.length > 0;
  suite.hasSuites = suite.suites.length > 0;
  suite.totalTests = suite.tests.length;
  suite.totalPasses = passingTests.length;
  suite.totalFailures = failingTests.length;
  suite.totalPending = pendingTests.length;
  suite.totalSkipped = skippedTests.length;
  suite.hasPasses = passingTests.length > 0;
  suite.hasFailures = failingTests.length > 0;
  suite.hasPending = pendingTests.length > 0;
  suite.hasSkipped = suite.skipped.length > 0;
  suite.duration = duration;

  if (suite.root) {
    suite.rootEmpty = suite.totalTests === 0;
  }

  removeAllPropsFromObjExcept(suite, [
    'title',
    'fullFile',
    'file',
    'tests',
    'suites',
    'passes',
    'failures',
    'pending',
    'skipped',
    'hasTests',
    'hasSuites',
    'totalTests',
    'totalPasses',
    'totalFailures',
    'totalPending',
    'totalSkipped',
    'hasPasses',
    'hasFailures',
    'hasPending',
    'hasSkipped',
    'root',
    'uuid',
    'duration',
    'rootEmpty',
    '_timeout'
  ]);

  function copyScreenShots(allTests){
    var test;
    for(var i=0;i<allTests.length;i++){
      test = allTests[i];
      var screenshotPath = test.parent.title.replace(/[^\/]+$/, function(all){
          return all.replace(/\s*[:\.\:\-\s]\s*/g, '_');
      })+'_'+(i+1);
      var screenshotSrcPath = path.resolve('screenshots/'+screenshotPath+'.png');
      if(fs.existsSync(screenshotSrcPath)){
        var screenshotNewPath = config.reportDir + '/screenshots/'+md5(screenshotSrcPath)+'.png';
        var screenshotDesPath = path.resolve(screenshotNewPath);
        fs.writeFileSync(screenshotDesPath, fs.readFileSync(screenshotSrcPath, 'binary'), 'binary');
        test.screenshot = screenshotNewPath.replace(/^.*?(screenshots\/)/, '$1');
      }
      var imgdiffSrcPath = path.resolve('screenshots/'+screenshotPath+'_diff.png');
      if(fs.existsSync(imgdiffSrcPath)){
        var imgdiffNewPath = config.reportDir + '/screenshots/'+md5(screenshotPath)+'.png';
        var imgdiffDesPath = path.resolve(imgdiffNewPath);
        fs.writeFileSync(imgdiffDesPath, fs.readFileSync(imgdiffSrcPath, 'binary'), 'binary');
        test.imgdiff = imgdiffNewPath.replace(/^.*?(screenshots\/)/, '$1');
      }
    }
  }

}

/**
 * Return a plain-object representation of `test`
 * free of cyclic properties etc.
 *
 * @param {Object} test
 * @return {Object}
 * @api private
 */

function cleanTest (test, index) {
  var code = test.fn ? test.fn.toString() : test.body,
      err = test.err ? _.pick( test.err, ['name', 'message', 'stack'] ) : test.err;

  var highlightCode = '';
  if (code) {
    highlightCode = cleanCode(code);
    highlightCode = Highlight.fixMarkup(Highlight.highlightAuto(highlightCode).value);
  }

  if (err && err.stack) {
    err.stack = Highlight.fixMarkup(Highlight.highlightAuto(err.stack).value);
  }

  var cleaned = {
    title: test.title,
    fullTitle: test.fullTitle(),
    timedOut: test.timedOut,
    duration: test.duration || 0,
    state: test.state,
    speed: test.speed,
    pass: test.state === 'passed',
    fail: test.state === 'failed',
    pending: test.pending,
    rawCode: cleanCode(code),
    code: highlightCode,
    err: err,
    isRoot: test.parent.root,
    uuid: uuid.v4(),
    parentUUID: test.parent.uuid,
    parentTitle: test.parent.title,
    screenshot: test.screenshot,
    imgdiff: test.imgdiff
  };

  cleaned.skipped = (!cleaned.pass && !cleaned.fail && !cleaned.pending);

  return cleaned;
}

/**
 * Strip the function definition from `str`,
 * and re-indent for pre whitespace.
 */

function cleanCode (str) {
  str = str
    .replace(/\r\n?|[\n\u2028\u2029]/g, '\n').replace(/^\uFEFF/, '')
    .replace(/^function *\(.*\) *{|\(.*\) *=> *{?/, '')
    .replace(/\s+\}$/, '');

  var spaces = str.match(/^\n?( *)/)[1].length,
      tabs = str.match(/^\n?(\t*)/)[1].length,
      re = new RegExp('^\n?' + (tabs ? '\t' : ' ') + '{' + (tabs ? tabs : spaces) + '}', 'gm');

  str = str.replace(re, '');
  str = str.replace(/^\s+|\s+$/g, '');
  return str;
}

/**
 * Remove all properties from an object except
 * those that are in the propsToKeep array.
 *
 * @param {Object} obj
 * @param {Array} propsToKeep
 * @api private
 */

function removeAllPropsFromObjExcept (obj, propsToKeep) {
  _.forOwn(obj, function(val, prop) {
    if (propsToKeep.indexOf(prop) === -1) {
      delete obj[prop];
    }
  });
}

/**
 * Return a classname based on percentage
 *
 * @param {Integer} pct
 * @api private
 */

function _getPercentClass (pct) {
  if (pct <= 50) {
    return 'danger';
  } else if (pct > 50 && pct < 80) {
    return 'warning';
  } else {
    return 'success';
  }
}
