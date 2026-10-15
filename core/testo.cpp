#include "testo.hpp"

#include "unicode.hpp"

#include <algorithm>
#include <sstream>

namespace anagrammi {

std::string trim(const std::string& text) {
    return trim_unicode(text);
}

std::string normalizza_testo(std::string text) {
    return normalizza_unicode(text);
}

bool contiene(const std::string& text, char ch) {
    return text.find(ch) != std::string::npos;
}

void rimuovi_tutti(std::string& text, char ch) {
    text.erase(std::remove(text.begin(), text.end(), ch), text.end());
}

std::vector<std::string> dividi(const std::string& text, char separator) {
    std::vector<std::string> parts;
    std::stringstream ss(text);
    std::string part;
    while (std::getline(ss, part, separator)) {
        parts.push_back(trim(part));
    }
    return parts;
}

} // namespace anagrammi
