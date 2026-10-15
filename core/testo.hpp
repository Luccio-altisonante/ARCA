#ifndef ANAGRAMMI_TESTO_HPP
#define ANAGRAMMI_TESTO_HPP

#include <string>
#include <vector>

namespace anagrammi {

std::string trim(const std::string& text);
std::string normalizza_testo(std::string text);
bool contiene(const std::string& text, char ch);
void rimuovi_tutti(std::string& text, char ch);
std::vector<std::string> dividi(const std::string& text, char separator);

} // namespace anagrammi

#endif
