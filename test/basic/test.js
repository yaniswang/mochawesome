var should = require('should');

describe('Master Test Suite', function () {
  describe('Test Suite - Basic', function () {
    it('passing test', function (done) {
      true.should.be.ok;
      done();
    });
    it('failing test', function (done) {
      false.should.be.ok;
      done();
    });
  });

  describe('Test Suite - Failed After Each', function () {
    it('passing test', function (done) {
      true.should.be.ok;
      done();
    });
    xit('pending test', function (done) {
      done();
    });
    it('failing test', function (done) {
      false.should.be.ok;
      done();
    });
    it('passing test', function (done) {
      true.should.be.ok;
      done();
    });
    xit('pending test', function (done) {
      done();
    });
    afterEach('failing afterEach hook', function () {
      console.log('a');
    });
  });
});