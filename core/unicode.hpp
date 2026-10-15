#ifndef ANAGRAMMI_UNICODE_HPP
#define ANAGRAMMI_UNICODE_HPP

#include <cstddef>
#include <string>
#include <string_view>

namespace anagrammi {

std::u32string decodifica_utf8(std::string_view testo, bool* valido = nullptr);
std::string codifica_utf8(std::u32string_view testo);
bool utf8_valido(std::string_view testo);
std::size_t lunghezza_utf8(std::string_view testo);
std::string trim_unicode(std::string_view testo);
std::string normalizza_nfc(std::string_view testo);
std::string minuscolo_unicode(std::string_view testo);
std::string normalizza_unicode(std::string_view testo);

} // namespace anagrammi

#endif
