
# 1) Obfuscation OFF (so it’s not UDP tunneled over TCP)
mullvad obfuscation get
# If not "off": mullvad obfuscation set mode off

# 2) See the UDP flow to the entry server (macOS)
# sudo tcpdump -ni any udp and host 23.234.70.127 and port 14156 -vv
# You should see steady UDP to the relay.

# 3) STUN shows working outbound UDP + mapping type
# Basic binding/mapped-address check
# turnutils_stunclient stun.l.google.com -p 19302

# (Optional) NAT behavior discovery (RFC5780) if the server supports it:
# turnutils_natdiscovery stun.l.google.com 19302

# 4) Repeat with fixed local ports to gauge port preservation (better for punching)
# for p in 40001 40002 40003; do
#   turnutils_stunclient -p $p stun.l.google.com 19302 2>/dev/null \
#     | egrep 'Binding test|Mapped address|Nat (filtering|behavior)'
# done

# 5) Ask HyperDHT what it thinks of your NAT
node -e "const DHT=require('hyperdht');(async()=>{const d=new DHT();await d.ready();await d.fullyBootstrapped();console.log({firewalled:d.firewalled,randomized:d.randomized});await d.destroy()})()"