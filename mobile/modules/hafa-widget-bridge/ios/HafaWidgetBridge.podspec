require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'HafaWidgetBridge'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'Shimizu Technology'
  s.homepage       = 'https://hafarecipes.com'
  # The host bridge itself uses no iOS 17-only API and therefore does not
  # independently raise the app target. The generated widget remains iOS 17+.
  s.platform       = :ios, '15.1'
  s.swift_version  = '5.0'
  s.source         = { git: 'https://github.com/Shimizu-Technology/hafa-recipes.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Security', 'WidgetKit'
  s.source_files = '**/*.swift'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'APPLICATION_EXTENSION_API_ONLY' => 'NO'
  }
end
