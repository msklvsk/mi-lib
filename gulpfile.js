'use strict';

const fs = require('fs');

const gulp = require('gulp');
const ts = require('gulp-typescript');
const tslint = require('gulp-tslint');
const sourcemaps = require('gulp-sourcemaps');
const babel = require('gulp-babel');
const uglify = require('gulp-uglify');
const del = require('del');
const mkdirp = require('mkdirp');


const TS_PROJ_FILE = 'src/tsconfig.json';
const tsProject = ts.createProject(TS_PROJ_FILE, { typescript: require('typescript') });


//------------------------------------------------------------------------------
function swallowError(error) {
  console.log(error.toString());
  this.emit('end');
}


//------------------------------------------------------------------------------
function tsTask(target) {
  let dest = target === 'es6' ? 'lib' : 'lib5';
  let babelOpts = target === 'es6' ? undefined : { presets: ['es2015'] };

  let tsResult = tsProject.src()
    .pipe(ts(tsProject));

  tsResult.dts.pipe(gulp.dest(dest));

  return tsResult.js
    .pipe(babel(babelOpts).on('error', swallowError))
    .pipe(gulp.dest(dest));
}

////////////////////////////////////////////////////////////////////////////////
gulp.task('typescript', [], () => {
  return tsTask('es6');
});

////////////////////////////////////////////////////////////////////////////////
gulp.task('lint', [], () => {
  tsProject.src()
    .pipe(tslint())
    .pipe(tslint.report('verbose'));
});

////////////////////////////////////////////////////////////////////////////////
gulp.task('es5', [], () => {
  return tsTask('es5');
});

////////////////////////////////////////////////////////////////////////////////
gulp.task('cleanup:dist', () => {
  return del(['../mi-lib-dist/**/*'], { force: true });
});

////////////////////////////////////////////////////////////////////////////////
gulp.task('typescript:dist', ['cleanup:dist'], () => {
  let tsProject = ts.createProject(TS_PROJ_FILE);
  return tsProject.src()
    .pipe(ts(tsProject))
    .js
    .pipe(babel({ presets: ['es2015'] }))
    .pipe(uglify())
    .pipe(gulp.dest('../mi-lib-dist/lib'));
});

////////////////////////////////////////////////////////////////////////////////
gulp.task('copy:dist', ['cleanup:dist'], () => {
  return gulp.src(['bin/**', 'data/dict/**', 'package.json'], { base: '.' })
    .pipe(gulp.dest('../mi-lib-dist/'));
});

////////////////////////////////////////////////////////////////////////////////
gulp.task('mi-web', ['typescript'], () => {
  let packageJson = {
    name: 'mi-lib',
    private: true,
    dependencies: JSON.parse(fs.readFileSync('package.json', 'utf8')).dependencies
  };
  mkdirp.sync('dist/mi-web');
  fs.writeFileSync('dist/mi-web/package.json', JSON.stringify(packageJson, null, 2));

  return gulp.src(['lib/**/*.js'], { base: '.' })
    .pipe(gulp.dest('dist/mi-web/'));
});


gulp.task('dist', ['typescript:dist', 'copy:dist']);
gulp.task('default', ['typescript']);

gulp.task('develop', ['default'], () => {
  gulp.watch(['src/**/*.ts', TS_PROJ_FILE], ['default']);
});