Pod::Spec.new do |s|
 s.name = 'HafaBabyShare'
 s.version = '1.0.0'
 s.summary = 'Private durable Håfa Baby share recovery'
 s.description = s.summary
 s.author = 'Shimizu Technology'
 s.homepage = 'https://shimizu-technology.com'
 s.license = { :type => 'MIT' }
 s.platforms = { :ios => '17.0' }
 s.source = { :git => '' }
 s.static_framework = true
 s.dependency 'ExpoModulesCore'
 s.swift_version = '5.9'
 s.source_files = '**/*.{h,m,mm,swift}'
end
