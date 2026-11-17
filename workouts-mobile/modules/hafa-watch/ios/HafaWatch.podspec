Pod::Spec.new do |s|
  s.name = 'HafaWatch'
  s.version = '1.0.0'
  s.summary = 'Phone and watch sync'
  s.description = 'Durable Watch Connectivity intake.'
  s.license = { :type => 'UNLICENSED' }
  s.author = 'Shimizu Technology'
  s.homepage = 'https://shimizu-technology.com'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/Shimizu-Technology/hafa-recipes.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WatchConnectivity'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
end
