Pod::Spec.new do |s|
  s.name = 'HafaPausedHealth'
  s.version = '1.0.0'
  s.summary = 'Recorded workout pause intervals'
  s.description = 'Preserves one actual workout with recorded pause and resume events.'
  s.license = { :type => 'UNLICENSED' }
  s.author = 'Shimizu Technology'
  s.homepage = 'https://shimizu-technology.com'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/Shimizu-Technology/hafa-recipes.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'HealthKit'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
end
