require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))
Pod::Spec.new do |s|
  s.name = 'HafaWorkoutsShare'
  s.version = package['version']
  s.summary = package['description']
  s.description = package['description']
  s.license = package['license']
  s.author = 'Shimizu Technology'
  s.homepage = 'https://hafaworkouts.com'
  s.platform = :ios, '17.0'
  s.swift_version = '5.0'
  s.source = { git: 'https://github.com/Shimizu-Technology/hafa-recipes.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Security'
  s.source_files = 'HafaWorkoutsShare*.swift'
end
